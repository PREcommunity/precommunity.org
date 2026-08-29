export type HeaderOverlay = 'theme' | 'notifications' | 'profile';

export const HEADER_OVERLAY_EVENT = 'precommunity:header-overlay';

export function openHeaderOverlay(overlay: HeaderOverlay) {
  window.dispatchEvent(new CustomEvent<HeaderOverlay>(HEADER_OVERLAY_EVENT, { detail: overlay }));
}
