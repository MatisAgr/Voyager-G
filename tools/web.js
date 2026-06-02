/**
 * Lance uniquement le dashboard web, sans demarrer le bot.
 * Utile pour consulter les sessions passees. (L'inventaire live a :3000
 * necessite un bot connecte, il n'est donc pas demarre ici.)
 */

const path = require("path");

// Toujours travailler depuis la racine du projet (chemins relatifs).
process.chdir(path.resolve(__dirname, ".."));
// Mode visualisation : empeche le dashboard de creer des sessions vides.
process.env.DASHBOARD_VIEWER_ONLY = "true";
require("dotenv").config();

const { startDashboard } = require("../src/dashboard/server");

console.log("Mode visualisation (sans bot). Ctrl+C pour arreter.");
startDashboard();
