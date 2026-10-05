/* Phase 4: offline checks of the Business Brain helpers in assets/growth-brain.js and of the
   prompt file. Run: node test/brain-helpers.test.mjs */
import fs from "node:fs";
import { extractJson, fitToSchema, languagesFor, modelSchema, normalizeBrain, stripDashes } from "../../../assets/growth-brain.js";
import { validate } from "../src/validate.js";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const schema = read("../schemas/brain.schema.json");
const intake = read("./fixtures/pilot-intake-v1.json");
const model = read("./fixtures/pilot-brain-v1.json");

ok(fs.readFileSync(new URL("../src/validate.js", import.meta.url), "utf8") === fs.readFileSync(new URL("../../../assets/growth-validate.js", import.meta.url), "utf8"), "assets/growth-validate.js is an exact copy of src/validate.js");
ok(extractJson("Sure!\n```json\n{\"a\":1}\n```\nDone.").a === 1, "extractJson reads a fenced reply");
ok(extractJson("text {\"a\":{\"b\":2}} trailing").a.b === 2, "extractJson reads a reply with text around it");
let threw = false;
try { extractJson("no json here"); } catch (e) { threw = true; }
ok(threw, "extractJson fails clearly when there is no JSON");
ok(stripDashes({ a: ["x \u2014 y"], b: { c: "p\u2014q" } }).b.c === "p, q", "stripDashes cleans nested text");
const ms = modelSchema(schema);
ok(!ms.properties.clientId && !ms.required.includes("brainVersion") && ms.properties.personas, "the model sees the schema without the fields the Vault owns");
ok(JSON.stringify(languagesFor("both")) === '["sv","en"]' && languagesFor("sv")[0] === "sv" && languagesFor("")[0] === "en", "languages follow the campaign language");

const raw = JSON.parse(JSON.stringify(model));
raw.clientId = "cl_wrong";
raw.brainVersion = 77;
raw.positioning.oneLiner = "x".repeat(400);
raw.words = { use: ["comfort on your plate", "New phrase"], avoid: [] };
raw.imageNotes = [{ fileId: "f_pic1aaaa", caption: "Skewers \u2014 grilled", bestUse: "Post" }, { fileId: "f_madeup1", caption: "x", bestUse: "y" }, { fileId: "f_pic1aaaa", caption: "dup", bestUse: "dup" }];
raw.extraKey = "dropped";
const doc = normalizeBrain(raw, { intake, clientId: "cl_chefsandy01", schema, languages: ["en"], pictureIds: ["f_pic1aaaa", "f_pic2aaaa"], intakeVersion: 1, nextVersion: 1 });
const v = validate(schema, doc);
ok(v.valid, "a normal model answer becomes a valid brain" + (v.valid ? "" : ": " + v.errors.join("; ")));
ok(doc.clientId === "cl_chefsandy01" && doc.brainVersion === 1 && doc.builtFromIntakeVersion === 1 && doc.editedByHarry === false, "identity fields come from ScriptForge, not the model");
ok(doc.positioning.oneLiner.length <= 300, "over-long text is trimmed to the schema limit");
ok(!("extraKey" in doc), "unknown keys are dropped");
ok(doc.imageNotes.length === 1 && doc.imageNotes[0].caption === "Skewers, grilled", "image notes keep only real picture ids, once, without em-dashes");
ok(doc.words.use.includes("Authentic West African Flavours, Cooked Fresh, Delivered Hot") && doc.words.use.filter((w) => /comfort on your plate/i.test(w)).length === 1 && doc.words.use.includes("New phrase"), "every brand word the client listed is kept, without duplicates");

const missing = JSON.parse(JSON.stringify(model));
delete missing.personas;
const d2 = normalizeBrain(missing, { intake, clientId: "cl_chefsandy01", schema, languages: ["en"], pictureIds: [], intakeVersion: 1, nextVersion: 1 });
ok(!validate(schema, d2).valid, "a missing section still fails validation, so the retry runs");

const prompt = read("../../../assets/growth/brain.prompt.json");
const all = JSON.stringify(prompt);
ok(!/\u2014/.test(all), "the prompt file has no em-dash");
ok(prompt.system.join("\n").includes("{{SCHEMA}}") && prompt.system.join("\n").includes("{{LANGUAGE_RULE}}") && prompt.user.join("\n").includes("{{INTAKE_JSON}}") && prompt.retry.includes("{{ERRORS}}"), "the prompt keeps its placeholders");
ok(prompt.languageRules.sv && prompt.languageRules.en && prompt.languageRules.both, "the prompt has rules for Swedish, English and both");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
