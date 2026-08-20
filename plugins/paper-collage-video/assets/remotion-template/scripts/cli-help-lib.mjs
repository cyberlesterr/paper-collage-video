// `--help` used to fall through to the "missing required argument" path, so a
// CLI printed its usage as `<command> failed: 用法：…` and exited non-zero.
// An agent reading that cannot tell a help request from a real failure, and
// the wrapped-command failure record treats it as one.
export const printCliHelp = (args, usage) => {
  if (!args.includes('--help') && !args.includes('-h')) return;
  console.log(usage);
  process.exit(0);
};
