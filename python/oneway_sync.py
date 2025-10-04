#!/usr/bin/env python3
"""One-way Google Calendar sync with deduplication."""

import os
import sys
import json
import time
import signal
from datetime import datetime, timedelta
from pathlib import Path
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID')
CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET')
REDIRECT_URI = os.getenv('OAUTH_REDIRECT_URI', 'http://localhost:3333/oauth/callback')

SOURCE_IDS = [s.strip() for s in os.getenv('SOURCE_CALENDAR_IDS', '').split(',') if s.strip()]
TARGET_ID = os.getenv('TARGET_CALENDAR_ID', 'primary')

STATE_FILE = os.getenv('STATE_FILE', 'state.json')
STATE_DISABLE = os.getenv('STATE_DISABLE') == '1'
LOCK_FILE = 'sync.lock'

# Reset options
RESET_ALL = '--reset' in sys.argv or os.getenv('RESET') == '1'
RESET_FOR = os.getenv('RESET_FOR', '')

ORIGIN_KEY = 'origin'


def load_tokens_env(key):
    """Load tokens from environment variable."""
    raw = os.getenv(key)
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except:
        return {}


def create_credentials(tokens_dict):
    """Create credentials object from tokens dict."""
    if not tokens_dict:
        return None

    # Convert expiry_date (ms timestamp) to datetime
    expiry = None
    if 'expiry_date' in tokens_dict and tokens_dict['expiry_date']:
        expiry = datetime.fromtimestamp(tokens_dict['expiry_date'] / 1000)

    return Credentials(
        token=tokens_dict.get('access_token'),
        refresh_token=tokens_dict.get('refresh_token'),
        token_uri='https://oauth2.googleapis.com/token',
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        scopes=tokens_dict.get('scope', '').split() if tokens_dict.get('scope') else None,
        expiry=expiry
    )


def load_state():
    """Load sync state from file."""
    if STATE_DISABLE:
        return {'syncTokens': {}}

    try:
        with open(STATE_FILE, 'r') as f:
            data = json.load(f)
            return {'syncTokens': data.get('syncTokens', {})}
    except:
        print(f'[state] no state at {STATE_FILE}; will sync upcoming 2 weeks')
        return {'syncTokens': {}}


def save_state(state):
    """Save sync state to file."""
    if STATE_DISABLE:
        return

    try:
        with open(STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f'[state] write failed: {e}')


def acquire_lock():
    """Acquire lock file to prevent concurrent syncs."""
    try:
        # Check if lock file exists
        if os.path.exists(LOCK_FILE):
            with open(LOCK_FILE, 'r') as f:
                pid_str = f.read().strip()
                try:
                    pid = int(pid_str)
                    # Check if process is still running
                    os.kill(pid, 0)
                    print(f'[lock] sync already running (PID {pid})')
                    return False
                except (ProcessLookupError, ValueError):
                    # Process doesn't exist, remove stale lock
                    print(f'[lock] removing stale lock for PID {pid_str}')
                    os.unlink(LOCK_FILE)

        # Create lock file
        with open(LOCK_FILE, 'w') as f:
            f.write(str(os.getpid()))
        return True

    except Exception as e:
        print(f'[lock] acquire failed: {e}')
        return False


def release_lock():
    """Release lock file."""
    try:
        if os.path.exists(LOCK_FILE):
            os.unlink(LOCK_FILE)
    except Exception as e:
        print(f'[lock] release failed: {e}')


def normalize_ical_uid(ical_uid):
    """Normalize iCalUID by removing @google.com suffix."""
    if not ical_uid:
        return ical_uid
    return ical_uid.replace('@google.com', '')


def iso_or_date(dt_obj, d_obj):
    """Get ISO string from dateTime or date."""
    return dt_obj or d_obj or ''


def build_origin_key(src_canonical_id, event):
    """Build unique origin key for event."""
    normalized_uid = normalize_ical_uid(event.get('iCalUID', event.get('id')))
    base = f"{src_canonical_id}:{normalized_uid}"

    # Handle recurring exceptions
    orig_start = event.get('originalStartTime', {})
    orig = iso_or_date(orig_start.get('dateTime'), orig_start.get('date'))

    return f"{base}:{orig}" if orig else base


def build_title_time_key(event):
    """Build key based on title and time for duplicate detection."""
    title = (event.get('summary', '') or '').strip().lower()
    start = event.get('start', {})
    end = event.get('end', {})
    start_time = iso_or_date(start.get('dateTime'), start.get('date'))
    end_time = iso_or_date(end.get('dateTime'), end.get('date'))
    return f"{title}:{start_time}:{end_time}"


def get_event_detail_score(event):
    """Score event based on amount of detail."""
    score = 0
    if event.get('description', '').strip():
        score += 2
    if event.get('location', '').strip():
        score += 1
    if event.get('attendees'):
        score += len(event['attendees'])
    if event.get('attachments'):
        score += len(event['attachments'])
    if event.get('reminders', {}).get('overrides'):
        score += 1
    return score


def is_event_newer(event_a, event_b):
    """Determine if event A is newer than event B."""
    time_a = datetime.fromisoformat(event_a.get('updated', event_a.get('created', '1970-01-01T00:00:00Z')).replace('Z', '+00:00')).timestamp()
    time_b = datetime.fromisoformat(event_b.get('updated', event_b.get('created', '1970-01-01T00:00:00Z')).replace('Z', '+00:00')).timestamp()

    if time_a != time_b:
        return time_a > time_b

    # If times are equal, prefer event with more details
    return get_event_detail_score(event_a) > get_event_detail_score(event_b)


def find_by_origin(target_api, target_id, key):
    """Find event by origin key."""
    try:
        response = target_api.events().list(
            calendarId=target_id,
            privateExtendedProperty=f'{ORIGIN_KEY}={key}',
            maxResults=10,
            singleEvents=False,
            showDeleted=False
        ).execute()

        items = response.get('items', [])

        if len(items) > 1:
            print(f'  ! found {len(items)} events for origin {key}, using oldest')
            items.sort(key=lambda x: datetime.fromisoformat(x['created'].replace('Z', '+00:00')))
            return items[0]

        return items[0] if items else None
    except Exception as e:
        print(f'  ! find_by_origin failed: {e}')
        return None


def find_by_ical_and_backfill(target_api, target_id, event, key):
    """Find event by iCalUID and backfill origin tag."""
    ical_uid = event.get('iCalUID')
    if not ical_uid:
        return None

    try:
        response = target_api.events().list(
            calendarId=target_id,
            iCalUID=ical_uid,
            maxResults=50,
            singleEvents=False,
            showDeleted=False
        ).execute()

        items = response.get('items', [])
        if not items:
            return None

        # Prefer exact instance match for recurring exceptions
        orig_start = event.get('originalStartTime', {})
        orig = iso_or_date(orig_start.get('dateTime'), orig_start.get('date'))

        if orig:
            for item in items:
                item_orig_start = item.get('originalStartTime', {})
                item_orig = iso_or_date(item_orig_start.get('dateTime'), item_orig_start.get('date'))
                if item_orig == orig:
                    winner = item
                    break
            else:
                winner = items[0]
        else:
            winner = items[0]

        # Backfill origin tag
        try:
            target_api.events().patch(
                calendarId=target_id,
                eventId=winner['id'],
                body={
                    'extendedProperties': {
                        'private': {ORIGIN_KEY: key}
                    }
                },
                sendUpdates='none'
            ).execute()
        except Exception as e:
            print(f'  ! backfill failed: {e}')

        return winner
    except Exception as e:
        print(f'  ! find_by_ical failed: {e}')
        return None


def find_by_title_time(target_api, target_id, event):
    """Find events by title and time."""
    title_time_key = build_title_time_key(event)
    title = title_time_key.split(':')[0] if ':' in title_time_key else ''

    if not title or not event.get('start'):
        return []

    # Search for events with same title in a time window
    start = event['start']
    search_start = datetime.fromisoformat((start.get('dateTime') or start.get('date')).replace('Z', '+00:00'))
    search_end = search_start + timedelta(days=1)

    try:
        response = target_api.events().list(
            calendarId=target_id,
            timeMin=search_start.isoformat(),
            timeMax=search_end.isoformat(),
            q=event.get('summary', ''),
            maxResults=50,
            singleEvents=True,
            showDeleted=False
        ).execute()

        items = response.get('items', [])
        return [item for item in items if build_title_time_key(item) == title_time_key]
    except Exception as e:
        print(f'  ! title/time search failed: {e}')
        return []


def mirror_body_from(event, key):
    """Create mirror event body."""
    return {
        'summary': event.get('summary', '(busy)'),
        'description': event.get('description'),
        'location': event.get('location'),
        'start': event.get('start'),
        'end': event.get('end'),
        'visibility': event.get('visibility'),
        'recurrence': event.get('recurrence'),
        'extendedProperties': {
            'private': {ORIGIN_KEY: key}
        }
    }


def resolve_canonical_id(source_api, cal_id):
    """Resolve primary to actual calendar ID."""
    if cal_id != 'primary':
        return cal_id

    try:
        result = source_api.calendarList().get(calendarId='primary').execute()
        return result.get('id', cal_id)
    except:
        return cal_id


def sync_one_source(source_api, target_api, source_id, target_id, state):
    """Sync one source calendar to target."""
    base_params = {
        'calendarId': source_id,
        'showDeleted': True,
        'maxResults': 2500
    }

    token = state['syncTokens'].get(source_id)
    if token:
        base_params['syncToken'] = token
    else:
        # Sync only upcoming 2 weeks
        now = datetime.utcnow()
        two_weeks = now + timedelta(weeks=2)
        base_params['timeMin'] = now.isoformat() + 'Z'
        base_params['timeMax'] = two_weeks.isoformat() + 'Z'

    page_token = None

    while True:
        try:
            params = base_params.copy()
            if page_token:
                params['pageToken'] = page_token

            response = source_api.events().list(**params).execute()
            items = response.get('items', [])

            print(f"[fetch] {source_id} -> {target_id} items={len(items)} {'(inc)' if token else '(full)'}")

            for i, event in enumerate(items):
                key = build_origin_key(source_id, event)

                # Rate limiting
                if i > 0 and i % 10 == 0:
                    time.sleep(0.1)

                # Handle cancelled events
                if event.get('status') == 'cancelled':
                    mirror = find_by_origin(target_api, target_id, key) or find_by_ical_and_backfill(target_api, target_id, event, key)
                    if mirror:
                        try:
                            target_api.events().delete(
                                calendarId=target_id,
                                eventId=mirror['id'],
                                sendUpdates='none'
                            ).execute()
                            event_time = event.get('start', {}).get('dateTime') or event.get('start', {}).get('date') or 'unknown date'
                            print(f"  - deleted mirror for {key} | \"{event.get('summary', '(no title)')}\" on {event_time}")
                        except Exception as e:
                            print(f"  ! delete failed for {key}: {e}")
                    continue

                # Find existing mirror
                mirror = None
                title_time_duplicates = []

                if not mirror:
                    title_time_duplicates = find_by_title_time(target_api, target_id, event)

                    if title_time_duplicates:
                        valid_duplicates = [
                            dup for dup in title_time_duplicates
                            if not dup.get('extendedProperties', {}).get('private', {}).get('origin') or
                               dup.get('extendedProperties', {}).get('private', {}).get('origin') != key
                        ]

                        if valid_duplicates:
                            current_event = {**event, **mirror_body_from(event, key)}
                            best_event = current_event
                            event_to_update = None

                            for dup in valid_duplicates:
                                if is_event_newer(dup, best_event):
                                    if best_event == current_event:
                                        event_to_update = dup
                                        best_event = dup
                                else:
                                    if event_to_update != dup:
                                        try:
                                            target_api.events().delete(
                                                calendarId=target_id,
                                                eventId=dup['id'],
                                                sendUpdates='none'
                                            ).execute()
                                            print(f"  - deleted older duplicate \"{dup.get('summary', '(no title)')}\" ({dup['id']}) with same title+time")
                                        except Exception as e:
                                            print(f"  ! failed to delete duplicate {dup['id']}: {e}")

                            if event_to_update and event_to_update != current_event:
                                mirror = event_to_update

                body = mirror_body_from(event, key)

                # Create or update event
                if not mirror:
                    # Triple-check before creating
                    mirror = find_by_origin(target_api, target_id, key)
                    if not mirror:
                        try:
                            created = target_api.events().insert(
                                calendarId=target_id,
                                body=body,
                                sendUpdates='none'
                            ).execute()
                            event_time = event.get('start', {}).get('dateTime') or event.get('start', {}).get('date') or 'unknown date'
                            print(f"  + created {created['id']} for {key} | \"{event.get('summary', '(no title)')}\" on {event_time}")
                        except Exception as insert_error:
                            print(f"  ! insert failed for {key}, checking for race condition: {insert_error}")

                            # Wait and check again
                            time.sleep(0.2)
                            mirror = find_by_origin(target_api, target_id, key)
                            if not mirror:
                                mirror = find_by_ical_and_backfill(target_api, target_id, event, key)

                            if mirror:
                                try:
                                    target_api.events().patch(
                                        calendarId=target_id,
                                        eventId=mirror['id'],
                                        body=body,
                                        sendUpdates='none'
                                    ).execute()
                                    event_time = event.get('start', {}).get('dateTime') or event.get('start', {}).get('date') or 'unknown date'
                                    print(f"  ~ updated {mirror['id']} for {key} (race condition resolved) | \"{event.get('summary', '(no title)')}\" on {event_time}")
                                except Exception as patch_error:
                                    print(f"  ! patch failed after race condition: {patch_error}")
                            else:
                                if 'duplicate' in str(insert_error).lower() or 'already exists' in str(insert_error).lower():
                                    print(f"  ! duplicate detected, event may already exist: {key}")
                                else:
                                    raise insert_error
                    else:
                        # Found during triple-check, update instead
                        target_api.events().patch(
                            calendarId=target_id,
                            eventId=mirror['id'],
                            body=body,
                            sendUpdates='none'
                        ).execute()
                        event_time = event.get('start', {}).get('dateTime') or event.get('start', {}).get('date') or 'unknown date'
                        print(f"  ~ updated {mirror['id']} for {key} (found during triple-check) | \"{event.get('summary', '(no title)')}\" on {event_time}")
                else:
                    target_api.events().patch(
                        calendarId=target_id,
                        eventId=mirror['id'],
                        body=body,
                        sendUpdates='none'
                    ).execute()
                    event_time = event.get('start', {}).get('dateTime') or event.get('start', {}).get('date') or 'unknown date'
                    print(f"  ~ updated {mirror['id']} for {key} | \"{event.get('summary', '(no title)')}\" on {event_time}")

            # Handle pagination and sync tokens
            page_token = response.get('nextPageToken')
            if response.get('nextSyncToken'):
                state['syncTokens'][source_id] = response['nextSyncToken']
                save_state(state)

            if not page_token:
                break

        except Exception as e:
            # Handle stale sync token
            if hasattr(e, 'resp') and e.resp.status == 410:
                print(f'[{source_id}] stale sync token → resetting to 2-week window')
                if source_id in state['syncTokens']:
                    del state['syncTokens'][source_id]
                save_state(state)

                if 'syncToken' in base_params:
                    del base_params['syncToken']
                now = datetime.utcnow()
                two_weeks = now + timedelta(weeks=2)
                base_params['timeMin'] = now.isoformat() + 'Z'
                base_params['timeMax'] = two_weeks.isoformat() + 'Z'
                page_token = None
                continue

            raise e


def main():
    """Main sync function."""
    if not SOURCE_IDS:
        print('Error: Set SOURCE_CALENDAR_IDS (comma-separated)')
        sys.exit(1)

    # Acquire lock
    if not acquire_lock():
        print('Sync already in progress, exiting.')
        return

    # Ensure lock is released on exit
    def cleanup_handler(signum, frame):
        release_lock()
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup_handler)
    signal.signal(signal.SIGTERM, cleanup_handler)

    try:
        # Load credentials
        source_tokens = load_tokens_env('SOURCE_TOKENS_JSON')
        target_tokens = load_tokens_env('TARGET_TOKENS_JSON')

        source_creds = create_credentials(source_tokens)
        target_creds = create_credentials(target_tokens)

        if not source_creds or not target_creds:
            print('Error: Missing credentials. Run auth.py first.')
            sys.exit(1)

        # Build API clients
        source_api = build('calendar', 'v3', credentials=source_creds)
        target_api = build('calendar', 'v3', credentials=target_creds)

        # Load state
        state = load_state()

        # Handle reset options
        if RESET_ALL:
            state['syncTokens'] = {}
        elif RESET_FOR:
            for cal_id in [s.strip() for s in RESET_FOR.split(',') if s.strip()]:
                if cal_id in state['syncTokens']:
                    del state['syncTokens'][cal_id]

        # Resolve canonical IDs
        canonical_source_ids = set()
        source_id_mapping = {}

        for raw_src_id in SOURCE_IDS:
            canonical_id = resolve_canonical_id(source_api, raw_src_id)
            canonical_source_ids.add(canonical_id)
            source_id_mapping[raw_src_id] = canonical_id

        print('---- Sync run', datetime.now().isoformat(), '----')
        print('Sources:', ', '.join([f'{k} -> {v}' for k, v in source_id_mapping.items()]))
        print('Canonical sources (deduplicated):', ', '.join(canonical_source_ids))
        print('Target:', TARGET_ID)

        # Sync each source
        for canonical_src_id in canonical_source_ids:
            sync_one_source(source_api, target_api, canonical_src_id, TARGET_ID, state)

        print('Done.')

    finally:
        release_lock()


if __name__ == '__main__':
    main()
