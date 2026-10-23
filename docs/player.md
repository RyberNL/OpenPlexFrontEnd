# Player

The player (`/watch/<id>`) plays movies, episodes and extras from the linked Plex server. This page covers how to control it and which subtitles and playback paths it supports.

## Keyboard shortcuts

Shortcuts work anywhere on the player page, except while typing in a text field. They also work while the seek bar has focus.

| Key           | Action                                                         |
| ------------- | -------------------------------------------------------------- |
| `Space` / `k` | Play or pause                                                  |
| `→`           | Forward 10 seconds                                             |
| `←`           | Back 10 seconds                                                |
| `↑`           | Volume up (10%)                                                |
| `↓`           | Volume down (10%)                                              |
| `m`           | Mute or unmute                                                 |
| `f`           | Full screen on or off                                          |
| `]`           | Faster (next speed step)                                       |
| `[`           | Slower (previous speed step)                                   |
| `c`           | Subtitles off, or back on with the last track (else the first) |
| `i`           | Show or hide File info                                         |
| `Esc`         | Close File info                                                |

Speed steps run from 0.25× to 3× in steps of 0.25×.

On a button that has focus, `Space` presses the button instead of pausing.

## Touch

- Tap the video to show or hide the controls.
- Double-tap the left or right half to go back or forward 10 seconds.
- The controls hide after a few seconds of playback. They stay visible while a menu or File info is open, or while you drag the seek bar.

## Seek bar, chapters and previews

- Pointing at or dragging the seek bar shows the time there and, for items with chapters, the chapter name.
- When Plex has generated preview thumbnails for the file, a thumbnail of that moment is shown too. Plex generates these when the server's "Generate video preview thumbnails" library setting is on.
- Chapters show as marks on the seek bar. **Chapters** in the controls lists them with their thumbnails and jumps to the one you choose.

## Intro, credits and what plays next

- Inside an intro or credits section detected by Plex, a **Skip Intro** or **Skip Credits** button appears. Plex detects these when the server's intro and credits detection is enabled.
- Under Settings → Playback, intros and credits can be skipped automatically. An "Intro skipped" notice then offers **Go back**, and that intro isn't skipped again.
- When an episode ends, or you skip its credits, **Up next** shows the following episode.
- Play and Shuffle on a playlist or collection play its items in turn. Shuffle uses a random order in which each item plays exactly once.
- With autoplay on (Settings → Playback, the default), the next item starts after a 10-second countdown. **Cancel** stops the countdown and keeps **Play next** available.

## Subtitles

Choose a track in the **CC** menu, or toggle with `c`. The choice is saved in Plex, so other Plex apps and the next episode use it too.

| Format                | Where it comes from      | How it's shown                                                                                         |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| SRT, WebVTT, MOV text | Sidecar file or embedded | Drawn by the player as text, using your appearance settings (size, colour, background, position)       |
| ASS / SSA             | Sidecar file or embedded | Rendered with full styling and positioning by libass (JASSUB), loaded only when such a track is chosen |
| PGS (`.sup`)          | Sidecar file             | Drawn as images by libpgs, loaded only when such a track is chosen; the file still plays directly      |
| PGS, VobSub, DVB      | Embedded                 | Burned into the video by the Plex server (a transcode)                                                 |

Notes:

- **Simple subtitles** (in the CC menu and in Settings → Playback) shows ASS/SSA as plain text with your appearance settings. The player also falls back to this when the browser can't run JASSUB.
- ASS fonts come from the subtitle file itself. Anything else uses the bundled Liberation Sans. Fonts that exist only as MKV attachments aren't available, because Plex doesn't offer them to clients.
- Embedded text subtitles are delivered by the Plex server, so playing them uses a stream from the server instead of direct play.
- If the browser can't draw a PGS file, playback restarts at the same position with the subtitles burned in.

## How a file is played

**Info** (or `i`) opens File info. It shows the file name, container, resolution, bitrate and size, and each video, audio and subtitle stream with the playing ones marked. It also shows how the file is being played, and why when it isn't played directly:

- **Direct play**: the browser plays the original file. This is used when the browser supports its container and codecs and the quality is set to Original.
- **Direct stream**: the Plex server repackages the file without re-encoding the video, for example from MKV to HLS.
- **Transcode**: the Plex server converts the file. Typical reasons are an unsupported video or audio codec, HDR on a display without HDR, a lower quality setting, another audio track than the file's first one, and burned-in subtitles.

The quality menu changes the target quality; playback continues from the same position. The server allows one video transcode at a time.

## Known limitations

- Fonts that are only stored as MKV attachments aren't used for ASS subtitles (see above).
- Embedded image subtitles can't be drawn by the browser, so they're always burned in.
