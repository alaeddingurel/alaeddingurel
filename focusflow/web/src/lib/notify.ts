export const notificationsSupported = () => typeof Notification !== "undefined";

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

export function notify(title: string, body: string) {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag: "focusflow", silent: true });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* some mobile browsers only allow notifications from a service worker */ }
}
