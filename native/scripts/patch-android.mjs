// Applies Looi branding + permissions to the generated Capacitor Android project.
// Run after `npx cap add android` (CI does this automatically).
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const res = path.join(root, "android/app/src/main/res");
const src = path.join(root, "resources/android");
if (!fs.existsSync(res)) throw new Error("android/ not found — run `npx cap add android` first");
for (const d of fs.readdirSync(src).filter((d) => d.startsWith("mipmap-"))) {
  for (const f of fs.readdirSync(path.join(src, d))) fs.copyFileSync(path.join(src, d, f), path.join(res, d, f));
}
for (const d of fs.readdirSync(res).filter((d) => d.startsWith("drawable"))) {
  const t = path.join(res, d, "splash.png");
  if (fs.existsSync(t)) fs.copyFileSync(path.join(src, "splash.png"), t);
}
fs.writeFileSync(path.join(res, "values/ic_launcher_background.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B0B0D</color>\n</resources>\n`);
fs.writeFileSync(path.join(res, "drawable/ic_launcher_background.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#0B0B0D"/></shape>\n`);
// Monochrome status-bar icon used by LocalNotifications (smallIcon: ic_stat_icon)
fs.writeFileSync(path.join(res, "drawable/ic_stat_icon.xml"), `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="64" android:viewportHeight="64">
  <path android:fillColor="#00000000" android:strokeColor="#FFFFFFFF" android:strokeWidth="6" android:pathData="M47,32a15,15 0,1 1,-30 0a15,15 0,1 1,30 0z"/>
  <path android:fillColor="#FFFFFFFF" android:pathData="M50.5,19.5a6,6 0,1 1,-12 0a6,6 0,1 1,12 0z"/>
</vector>
`);
const mf = path.join(root, "android/app/src/main/AndroidManifest.xml");
let m = fs.readFileSync(mf, "utf8");
for (const perm of ["android.permission.POST_NOTIFICATIONS", "android.permission.RECEIVE_BOOT_COMPLETED", "android.permission.WAKE_LOCK"]) {
  if (!m.includes(perm)) m = m.replace('<uses-permission android:name="android.permission.INTERNET" />', `<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="${perm}" />`);
}
fs.writeFileSync(mf, m);
console.log("android patched");
// Background Runner ships its JS engine as a local .aar — expose it to the app module
const bg = path.join(root, "android/app/build.gradle");
let g = fs.readFileSync(bg, "utf8");
const libDir = "'../../node_modules/@capacitor/background-runner/android/src/main/libs'";
const aarDir = path.join(root, "node_modules/@capacitor/background-runner/android/src/main/libs");
const hasAar = fs.existsSync(aarDir) && fs.readdirSync(aarDir).some((f) => f.endsWith(".aar"));
if (hasAar && !g.includes("background-runner/android/src/main/libs")) {
  g = g.replace("dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'", `dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs', ${libDir}`);
  fs.writeFileSync(bg, g);
}
// Background Runner merges location permissions we never use — strip them from the final manifest
let mm = fs.readFileSync(mf, "utf8");
if (!mm.includes("xmlns:tools")) mm = mm.replace("<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\"", "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\"\n    xmlns:tools=\"http://schemas.android.com/tools\"");
for (const p of ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION"]) {
  const tag = `<uses-permission android:name="android.permission.${p}" tools:node="remove" />`;
  if (!mm.includes(tag)) mm = mm.replace("</manifest>", `    ${tag}\n</manifest>`);
}
fs.writeFileSync(mf, mm);
