Place these optional audio files in this directory:

correct.mp3    Played after a correct answer.
incorrect.mp3  Played after an incorrect or skipped answer.
confetti.mp3   Played on the results screen after a perfect score.

Audio files are not included. The app works without them.
Use the exact lowercase filenames above.

With sound enabled, supported browsers preload and decode the files for immediate
quiz feedback. Detected leading silence is skipped during playback; the original
files are unchanged. Short clips with little leading silence also work best in
the media fallback. Sound effects remain separate from word pronunciation.

Media elements preload as well as decoded buffers. If Web Audio is not running
or a buffer cannot start, the app immediately uses the prepared media element
without waiting for audio-context resume or scheduling delayed playback.
