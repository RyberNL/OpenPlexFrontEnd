#!/usr/bin/env bash
# Runs the e2e suite in chunks (by area and browser engine) so a small machine never has the
# whole suite's browsers and servers in memory at once. Each chunk gets a fresh app server,
# fake PMS and database. Usage: [ONLY="auth playback"] scripts/test-e2e-chunked.sh [chromium|webkit ...]
set -uo pipefail
# (pipefail makes a failing `playwright | tee` count as a failure.)
cd "$(dirname "$0")/.."

ENGINES=("${@:-chromium webkit}")
read -r -a ENGINES <<< "${ENGINES[*]}"

declare -A CHUNKS=(
	[auth]="login change-password sessions totp passkeys recovery-codes security-settings"
	[admin]="admin-users admin-mfa-reset admin-audit admin-plex-mapping plex-availability image-relay token-leak har-session"
	[ui]="smoke layout touch-targets pwa discover library-grid"
	[browse]="details shows collections-playlists-people search"
	[playback]="stream-relay player progress transcode-stop queue"
	[playback2]="playback-errors quality audio-tracks subtitles markers chapters file-info"
	[live]="live-tv live-guide live-watch"
)
ORDER=(auth admin ui browse playback playback2 live)
SELECTED=(${ONLY:-${ORDER[*]}})

# Every e2e file must belong to a chunk, so nothing is silently skipped.
for file in e2e/*.e2e.ts; do
	name=$(basename "$file" .e2e.ts)
	[[ $name == setup ]] && continue
	found=0
	for chunk in "${ORDER[@]}"; do [[ " ${CHUNKS[$chunk]} " == *" $name "* ]] && found=1; done
	if [[ $found == 0 ]]; then echo "e2e/$name.e2e.ts is not in any chunk" >&2; exit 2; fi
done

echo "Building once…"
npm run build > /dev/null || exit 1

failed=()
flaky=()
for chunk in "${SELECTED[@]}"; do
	files=(e2e/setup.e2e.ts)
	for name in ${CHUNKS[$chunk]}; do files+=("e2e/$name.e2e.ts"); done
	for engine in "${ENGINES[@]}"; do
		available=$(free -m | awk '/^Mem:/ {print $7}')
		echo "▶ $chunk / $engine (${available} MB available)"
		log=$(mktemp)
		if ! E2E_PREBUILT=1 npx playwright test "${files[@]}" \
			--project=setup --project="$engine-mobile" --project="$engine-desktop" \
			--reporter=line 2>&1 | tee "$log"; then
			failed+=("$chunk/$engine")
		fi
		grep -qE '^\s+[0-9]+ flaky' "$log" && flaky+=("$chunk/$engine")
		rm -f "$log"
	done
done

if ((${#flaky[@]})); then
	echo "⚠ Flaky (passed on retry): ${flaky[*]}"
fi
if ((${#failed[@]})); then
	echo "✘ Failed chunks: ${failed[*]}"
	exit 1
fi
echo "✔ All chunks passed"
