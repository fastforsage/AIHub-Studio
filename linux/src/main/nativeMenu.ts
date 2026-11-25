export interface NativeMenuController {
  setApplicationMenu(menu: null): void;
}

export interface NativeMenuWindow {
  removeMenu(): void;
}

/**
 * Removes Electron's default application and window menu bars.
 * Native window decorations remain under the desktop compositor's control.
 */
export function removeNativeApplicationMenu(
  applicationMenu: NativeMenuController,
  window: NativeMenuWindow
): void {
  applicationMenu.setApplicationMenu(null);
  window.removeMenu();
}
