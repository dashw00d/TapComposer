/** Only one transport should be heard while capturing or comparing. */
export function pauseOtherAudio(except?: HTMLAudioElement) {
  document.querySelectorAll('audio').forEach((audio) => {
    if (audio !== except) audio.pause();
  });
}
