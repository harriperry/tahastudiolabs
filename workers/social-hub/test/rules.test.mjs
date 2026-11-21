/* Caption rules suite: image, own caption and at least 4 hashtags on Facebook and Instagram. */
import { captionCore, checkPost, hashtagsOf } from "../src/rules.js";
import { PANEL_JS } from "../src/panel.js";
import { call, counter, makeEnv, makeSession, seedClient } from "./helpers.mjs";

const { ok, done } = counter();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => { if (String(url).startsWith("https://api.resend.com/")) return new Response("{}", { status: 200 }); throw new Error("unexpected network call: " + url); };

const on = { SOCIAL_CAPTION_RULES: "on" };
const IMG = "https://tahastudiolabs.com/api/vault/social/media/Ro_YARi3-kgdQ8Ptat0jQ6qO.jpg";
const GOOD = "We just opened our new studio in Örebro and cannot wait to show you what we are building for local businesses.\n\n#TAHAStudioLabs #Örebro #SocialMediaMarketing #SmallBusinessSweden";

/* pure checks */
ok(hashtagsOf("a #One #two #TWO #3 #12ab x#nope #Åre").join(",") === "one,two,12ab,åre", "hashtags are unique, case-insensitive, need a letter and a leading space");
ok(captionCore("Hello #tag http://x.co world").trim() === "Hello world", "the caption core drops hashtags and links");
ok(checkPost(on, { platform: "facebook", body: GOOD, mediaUrl: IMG }).length === 0, "a complete post passes");
ok(checkPost(on, { platform: "instagram", body: GOOD, mediaUrl: IMG }).length === 0, "a complete instagram post passes");
ok(checkPost(on, { platform: "facebook", body: GOOD }).join() === "image_required", "an image is required");
ok(checkPost(on, { platform: "facebook", body: GOOD.replace(/#\S+/g, ""), mediaUrl: IMG }).includes("hashtags_min"), "no hashtags is refused");
ok(checkPost(on, { platform: "facebook", body: GOOD.replace("#SmallBusinessSweden", ""), mediaUrl: IMG }).join() === "hashtags_min", "three hashtags is refused");
ok(checkPost(on, { platform: "facebook", body: GOOD + " #tahastudiolabs #ÖREBRO", mediaUrl: IMG }).length === 0, "repeated tags do not count twice and do not break the post");
ok(checkPost(on, { platform: "facebook", body: "Short #a1 #b2 #c3 #d4", mediaUrl: IMG }).join() === "caption_too_short", "a very short caption is refused");
ok(checkPost(on, { platform: "facebook", body: "Lorem ipsum dolor sit amet consectetur adipiscing elit #a1 #b2 #c3 #d4", mediaUrl: IMG }).join() === "caption_not_original", "placeholder text is refused");
const many = Array.from({ length: 31 }, (_, i) => "#tag" + i).join(" ");
ok(checkPost(on, { platform: "instagram", body: "A genuine long caption for the feed today. " + many, mediaUrl: IMG }).join() === "hashtags_max", "more than 30 hashtags is refused");
ok(checkPost({}, { platform: "facebook", body: "x" }).length === 0, "rules are off unless switched on");
ok(checkPost(on, { platform: "mock", body: "x" }).length === 0, "the mock platform is not affected");

/* proposals */
async function setup(extra = {}) {
  const env = makeEnv({ ...on, ...extra });
  await seedClient(env, "cl_a", "a@example.com");
  const a = await makeSession(env, { role: "client", clientId: "cl_a", email: "a@example.com" });
  const admin = await makeSession(env, { role: "admin", email: "admin@example.com" });
  return { env, a, admin };
}
const propose = (env, admin, items) => call(env, "POST", "/proposals", { cookie: admin, body: { clientId: "cl_a", items } });
{
  const { env, admin } = await setup();
  const bad = await propose(env, admin, [{ platform: "facebook", body: "Quick post #a1 #b2" }]);
  ok(bad.status === 400 && bad.data.error === "caption_rules" && bad.data.problems.includes("image_required") && bad.data.problems.includes("hashtags_min"), "a proposal that breaks the rules is refused with the reasons");
  const mixed = await propose(env, admin, [{ platform: "facebook", body: GOOD, mediaUrl: IMG }, { platform: "instagram", body: GOOD }]);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_proposals").first();
  ok(mixed.status === 400 && mixed.data.index === 1 && n.n === 0, "one bad item refuses the whole batch and stores nothing");
  const good = await propose(env, admin, [{ platform: "facebook", body: GOOD, mediaUrl: IMG }, { platform: "instagram", body: GOOD, mediaUrl: IMG }]);
  ok(good.status === 200 && good.data.ids.length === 2, "a batch that follows the rules is accepted");
}

/* the client cannot approve an edit that breaks the rules, and the proposal stays pending */
{
  const { env, a, admin } = await setup({ SOCIAL_CONNECTORS: "mock" });
  await call(env, "POST", "/consent", { cookie: a });
  const s = await call(env, "POST", "/oauth/start", { cookie: a, body: { platform: "mock" } });
  const state = new URL(s.data.url).searchParams.get("state");
  const cb = await call(env, "GET", "/oauth/callback/mock?state=" + state + "&code=good-pg1", { cookie: a });
  const p = await propose(env, admin, [{ platform: "facebook", body: GOOD, mediaUrl: IMG }]);
  const id = p.data.ids[0];
  const row = await env.DB.prepare("SELECT platform FROM social_proposals WHERE id = ?").bind(id).first();
  ok(row.platform === "facebook", "the proposal is a facebook proposal");
  const strip = await call(env, "POST", "/proposals/decide", { cookie: a, body: { proposalId: id, action: "approve", body: "Now with no tags at all, but long enough to be a caption.", accountId: cb.data.accountId, runAt: Date.now() + 3600000 } });
  const st = await env.DB.prepare("SELECT status FROM social_proposals WHERE id = ?").bind(id).first();
  ok(strip.status === 400 && strip.data.error === "caption_rules" && strip.data.problems.includes("hashtags_min") && st.status === "pending", "approving an edit without hashtags is refused and the proposal stays pending");
}

/* manual drafts */
{
  const { env, a } = await setup();
  const r1 = await call(env, "POST", "/versions", { cookie: a, body: { platform: "instagram", body: "hello", mediaUrl: IMG } });
  ok(r1.status === 400 && r1.data.error === "caption_rules", "a manual draft must follow the rules too");
  const r2 = await call(env, "POST", "/versions", { cookie: a, body: { platform: "instagram", body: GOOD, mediaUrl: IMG } });
  ok(r2.status === 200, "a manual draft that follows the rules is saved");
  const e2 = makeEnv({});
  await seedClient(e2, "cl_a", "a@example.com");
  const a2 = await makeSession(e2, { role: "client", clientId: "cl_a", email: "a@example.com" });
  const r3 = await call(e2, "POST", "/versions", { cookie: a2, body: { platform: "instagram", body: "hello", mediaUrl: IMG } });
  ok(r3.status === 200, "with the switch off nothing changes");
}

/* panel */
ok(PANEL_JS.includes("prob_hashtags_min") && PANEL_JS.includes("ruleHint") && !PANEL_JS.includes(String.fromCharCode(8212)), "the panel shows the rules and the reasons in both languages");

globalThis.fetch = realFetch;
done();
