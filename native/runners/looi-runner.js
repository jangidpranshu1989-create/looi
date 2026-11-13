// Runs in the OS background (Android WorkManager / iOS BGTaskScheduler, min ~15 min).
// Polls the Looi server and raises native notifications for approvals and updates.
addEventListener("looiCheck", async (resolve, reject, args) => {
  try {
    // The app passes its config on launch; persist it for later OS-scheduled runs.
    if (args && args.server) {
      CapacitorKV.set("server", args.server);
      CapacitorKV.set("device", args.device || "");
      return resolve();
    }
    const server = CapacitorKV.get("server")?.value;
    const device = CapacitorKV.get("device")?.value;
    if (!server) return resolve();
    const res = await fetch(server.replace(/\/$/, "") + "/api/live", { headers: { "X-Looi-Device": device || "" } });
    const live = await res.json();
    const lastSeen = Number(CapacitorKV.get("lastNotif")?.value || 0);
    const n = live.latest;
    const notes = [];
    if (n && n.id > lastSeen) {
      notes.push({ id: 1000 + (n.id % 100000), title: n.title, body: n.body || "" });
      CapacitorKV.set("lastNotif", String(n.id));
    }
    const pending = (live.approvals || []).length;
    const lastPending = Number(CapacitorKV.get("lastPending")?.value || 0);
    if (pending > lastPending) notes.push({ id: 7, title: "Approval needed", body: `${pending} ad batch${pending > 1 ? "es" : ""} waiting — tap to review.` });
    CapacitorKV.set("lastPending", String(pending));
    if ((live.jobs || []).length) {
      const j = live.jobs[0];
      notes.push({ id: 8, title: `Looi · ${j.name}`, body: `${j.stage} — ${j.progress}%` });
    }
    if (notes.length) CapacitorNotifications.schedule(notes);
    resolve();
  } catch (e) {
    reject(e);
  }
});
