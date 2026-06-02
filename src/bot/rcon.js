/**
 * Client RCON minimal (sans dependance) pour op le bot automatiquement au spawn.
 * Le bot change de nom a chaque iteration, donc il n'est pas op par defaut.
 * Necessite dans server.properties : enable-rcon=true, rcon.password, rcon.port.
 */

const net = require("net");
const logger = require("../utils/logger");

const TYPE_AUTH         = 3;
const TYPE_COMMAND      = 2;
const TYPE_AUTH_FAILED  = -1;

/** Construit un paquet RCON. */
function buildPacket(id, type, body) {
  const bodyBuf = Buffer.from(body, "ascii");
  const length = 4 + 4 + bodyBuf.length + 2; // id + type + corps + 2 octets nuls
  const buf = Buffer.alloc(4 + length);
  buf.writeInt32LE(length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  return buf;
}

/** Connexion, auth, une commande, renvoie la reponse texte, puis ferme. */
function sendCommand({ host, port, password, timeout = 5000 }, command) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buffer = Buffer.alloc(0);
    let authed = false;
    let settled = false;

    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      err ? reject(err) : resolve(val);
    };

    const timer = setTimeout(() => finish(new Error("RCON timeout")), timeout);

    socket.on("connect", () => socket.write(buildPacket(1, TYPE_AUTH, password)));
    socket.on("error", (e) => finish(e));

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Lit tous les paquets complets recus.
      while (buffer.length >= 4) {
        const len = buffer.readInt32LE(0);
        if (buffer.length < 4 + len) break;
        const packet = buffer.subarray(4, 4 + len);
        buffer = buffer.subarray(4 + len);

        const id = packet.readInt32LE(0);
        const body = packet.subarray(8, packet.length - 2).toString("ascii");

        if (!authed) {
          if (id === TYPE_AUTH_FAILED) return finish(new Error("RCON auth failed (wrong password)"));
          authed = true;
          socket.write(buildPacket(2, TYPE_COMMAND, command));
        } else {
          return finish(null, body);
        }
      }
    });
  });
}

/** Config RCON depuis l'environnement. */
function rconConfig() {
  return {
    host:     process.env.MC_HOST || "localhost",
    port:     parseInt(process.env.RCON_PORT, 10) || 25575,
    password: process.env.RCON_PASSWORD || "",
  };
}

/** Faux seulement si l'auto-op est explicitement desactive. */
function isEnabled() {
  return process.env.RCON_ENABLED !== "false";
}

/** Op le username via RCON et applique la config recommandee. Ne jette jamais. */
async function ensureOp(username) {
  if (!isEnabled()) {
    logger.info("Rcon", "RCON auto-op disabled (RCON_ENABLED=false).");
    return;
  }

  const cfg = rconConfig();
  if (!cfg.password) {
    logger.warn("Rcon", "RCON_PASSWORD is empty — skipping auto-op. Set it in .env and enable RCON in server.properties, or /op the bot manually.");
    return;
  }

  try {
    await sendCommand(cfg, `op ${username}`);
    logger.info("Rcon", `Auto-opped "${username}" via RCON.`);
  } catch (err) {
    logger.warn("Rcon", `Auto-op failed (${err.message}). The bot will run without OP — /op ${username} manually if needed.`);
    return;
  }

  // Applique la config confort une fois (idempotent).
  if (process.env.RCON_APPLY_SETUP !== "false") {
    const setup = [
      "gamerule keepInventory true",
      "gamerule doDaylightCycle false",
      "difficulty easy",
      "effect give @a minecraft:night_vision 99999 1 true",
    ];
    for (const cmd of setup) {
      try { await sendCommand(cfg, cmd); } catch (_) { /* au mieux */ }
    }
    logger.info("Rcon", "Applied recommended server setup (gamerules, difficulty, night vision).");
  }
}

module.exports = { ensureOp, sendCommand };
