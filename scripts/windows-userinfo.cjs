const os = require("node:os");
const original = os.userInfo;
try {
  original();
} catch {
  os.userInfo = () => ({
    username: "sandbox",
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.cwd(),
  });
}
