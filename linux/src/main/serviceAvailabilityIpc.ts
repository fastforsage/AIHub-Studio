import { ipcMain, IpcMainInvokeEvent } from "electron";
import { ServiceAvailabilityManager } from "../availability/serviceAvailabilityManager";

type TrustedSender = (event: IpcMainInvokeEvent) => boolean;

export function registerServiceAvailabilityIpc(
  manager: ServiceAvailabilityManager,
  isTrusted: TrustedSender
): void {
  ipcMain.handle("availability:check-catalog", async (event) => {
    if (!isTrusted(event)) {
      throw new Error("Untrusted renderer attempted to access service availability checks");
    }
    return manager.checkCatalog();
  });
}
