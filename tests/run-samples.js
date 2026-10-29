const { decodeShare, profileOf, Engine } = require("./harness");
const { links } = require("./samples");
Object.entries(links).forEach(([name, link]) => {
  const build = decodeShare("x" + link);
  const settings = Engine.sanitizeSettings(build.test);
  build.test = settings;
  const profile = profileOf(build, settings);
  console.log("==", name, profile.form.m1, "/", profile.form.m2, "perks:", JSON.stringify(profile.perks));
  ["dps", "tank", "debuff", "heal"].forEach((mode) => {
    const started = Date.now();
    const report = Engine.simulate(profile, Engine.tabOptions(settings, mode));
    const uptime = Object.entries(report.uptime).map(([key, value]) => `${key} ${(value.time / report.duration * 100).toFixed(0)}% p${(value.potencyTime / Math.max(1e-9, value.time)).toFixed(2)}`).join(", ");
    console.log(` ${mode} ${Date.now() - started}ms dmg ${report.damage.toFixed(0)} dps ${(report.damage / report.duration).toFixed(1)} heal ${(report.healing.self + report.healing.allies).toFixed(1)} taken ${report.taken.total.toFixed(0)} spirits ${report.spirits.toFixed(2)}`);
    if (mode === "dps") { console.log("  sources", JSON.stringify(Object.fromEntries(Object.entries(report.bySource).map(([k, v]) => [k, +v.toFixed(0)])))); console.log("  procs", JSON.stringify(Object.fromEntries(Object.entries(report.byProc).map(([k, v]) => [k, +v.toFixed(0)])))); console.log("  uptime", uptime); console.log("  steps", report.steps.map((step) => `${step.action}:${step.damage.toFixed(0)} u${step.uses.toFixed(1)} s${step.skipped.toFixed(1)}`).join(" ")); }
    if (report.errors.length) console.log("  ERRORS", report.errors);
  });
});
