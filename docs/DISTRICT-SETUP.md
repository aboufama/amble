# Amble: setup guide for districts

This guide is for a district technology coordinator who is setting up Amble for students. It covers what Amble sends, how to provide the AI helper safely, every setting Amble reads, and what is still missing before a district-wide rollout. Amble is made by Andre.

Every copy of Amble also has its own IT page at `#/it` (on the public copy, <https://aboufama.github.io/amble/#/it>). It shows the live details for that copy: the hosts to allow, the content security policy it runs with, a managed configuration example and the build settings.

Examples in this guide use `example.org` addresses. Replace them with your own.

## In short

- Amble is a set of static files (HTML, JavaScript, CSS, fonts and starter worlds). It has no server of its own, no accounts, no analytics, no ads and no cookies.
- Student work stays in the browser's storage on the Chromebook until a student saves an `.amble` file, for example to Google Drive through the ChromeOS save dialog.
- Games run in a sandboxed frame that can't reach the network or Amble's storage.
- The AI helper is optional and off until you set it up. It writes game code from a student's words and never draws. It talks only to an OpenAI-compatible address that your district runs. Amble ships no AI address and no key.
- Everything except the AI helper's own jobs works without AI: drawing, bones, the five starter worlds, dials and twists, Look inside, Footsteps, files, Hand in and the Teacher desk.
- Once it has loaded, Amble is an installable app that opens without a network. A new version downloads in the background and starts at the next launch, never in the middle of a lesson.

## 1. What Amble sends, and what it doesn't

### Hosts

| Host | Why | When |
|---|---|---|
| The host that serves Amble (the public copy: `aboufama.github.io`) | Amble's own files, fonts and starter worlds | When Amble opens, and to check for a new version |
| Your AI address (for example `amble-ai.example.org`) | AI requests | Only when a student uses the AI helper, or a teacher or grown-up tests the address |
| Anything else | Nothing | Never |

The host sees ordinary request details, such as IP addresses. GitHub Pages keeps them for security. Games make no requests at all: their frame's content security policy has `connect-src 'none'`. The page's own policy allows connections to Amble's host plus your AI origin (in a copy built with `VITE_AMBLE_AI_BASE_URL`, section 4.3) or any https address (in the public copy).

### What an AI request contains

Every request starts with Amble's fixed instructions for that job, published word for word at `#/ai`. Every request also asks the service not to store it (`store: false`), where the service accepts that setting. Then, by job:

| Job | When | What the request adds |
|---|---|---|
| Plan a new world | A student describes an idea in New world | The idea, the content level, the list of starter worlds, and the name and body type of the hero if the student drew one first |
| Build, change or fix a world | Building a planned world, Ask, or Ask Amble to fix it | The student's words; the content level; the world's title and code (every file when the code is 40,000 bytes or less, otherwise the files that matter plus a list of the others); the cast list (each member's name, kind, body type, size and facing, and whether it is drawn); the dial values; the twists that are on; the object groups the code uses; which line ranges the student wrote by hand and which the teacher locked; the last robot-test result. A build adds the plan and the chosen starter's code. A fix adds the error messages and the lines around them. |
| Explain | Explain this, in Look inside | Up to 60 lines of the world's code, the world's title, the content level and the student's question |
| Magic bones (optional) | A student asks for AI help finding a drawing's joints and presses Send the outline | One plain black-and-white outline of that drawing (at most 256 pixels on its longest side, with no colours or inner lines) and the kind of body the student picked |
| Moderation (optional) | Before a request, and on the words a new version of a game would show | Those words only, never code |
| Connection test | A teacher or grown-up presses the test | "Reply with the word OK." |

One request from a student can lead to a few more: up to two automatic repairs when the new code fails Amble's checks or its robot test, a resend or a continuation when a reply didn't apply or was cut off, and one retry when the words in a new version failed the safety check. Amble runs one AI job per world at a time, and waits a random 0 to 3 seconds before a build's first request, so a class that presses Build together arrives spread out.

### What is never sent

- A student's name, nickname or initials. (Hand in suggests initials for the file name. They stay in the file.)
- The class code in a request body. It travels only in a header to your AI address, and the request log doesn't keep headers.
- Device or install IDs, except the optional `safety_identifier` (section 4).
- Drawings (except the Magic bones outline), sound recordings, and pen movements. Pen timing and pressure never leave the Chromebook: New Hampshire counts handwriting as biometric information (RSA 189:65).
- Footsteps (a world's history), other worlds, and the request log.

Students can still type private things into Ask. Before anything is sent, Amble looks for emails, phone numbers, street addresses, names ("my name is..."), birthdays, school names and passwords. At the elementary level the request is blocked until the student takes it out; at the middle and high levels the student is warned and can press Remove it or Send anyway.

### What stays on the Chromebook

- In the browser's storage for Amble: worlds (code, drawings, bones, sounds, dials and Footsteps), pen movements (used to replay a drawing and to recover from a crash), settings, the class the student joined (with its AI address and class code), and the last 50 AI requests, exactly as sent (What Amble sends, `#/sent`, which the student can clear).
- In the browser's cache: Amble's own files, for offline use.
- `.amble` files hold one world, its drawings, its last 20 footsteps and a thumbnail. They never hold pen movements, drafts, the request log, class codes, keys or settings.
- Settings → Storage has **Save all my worlds** (one zip of `.amble` files) and **Delete everything Amble keeps on this Chromebook**.

Anyone who uses the same Chrome profile on a Chromebook can open Amble and see its worlds. Other web pages served from the same origin as Amble could read its storage, which is why schools need an address that serves nothing else (section 10).

## 2. Choosing an AI provider

Amble never comes with an AI address or a key. Your district chooses the service, signs its own agreement with the provider, and runs a proxy that holds the key. Students never see or type a key: they use a class code, or no credential at all.

Provider terms change, so check the current ones. As reviewed in September 2026:

- **Recommended: Azure OpenAI behind your proxy.** Microsoft doesn't use the prompts to train models and doesn't make them available to OpenAI, its content filters are on by default, and you choose the region where data is processed. Its abuse monitoring can keep flagged samples for review unless you are approved for modified abuse monitoring.
- **The OpenAI API behind your proxy, with Zero Data Retention (ZDR).** OpenAI's terms say not to process personal data of children under 13 without ZDR, and Amble's students start at about age 9. For users under 18, OpenAI also expects age-appropriate disclosures (Amble shows students an explainer before their first request), content filters (section 5) and monitoring with escalation paths (your proxy and your staff). The API doesn't train on your data by default, and OpenAI keeps flagged image inputs even under ZDR, which is one more reason to leave pictures off (section 4).
- **Not for students: Google's Gemini Developer API.** Its terms require users to be 18 or older and forbid apps that are directed at, or likely to be used by, people under 18. Amble is for students aged about 9 to 18, so that API isn't allowed. Consumer ChatGPT accounts aren't for students either (13 and up, with a parent's permission under 18). Amble's dev-server bridge to the Codex CLI never ships in a published copy.

For any other provider, check its terms for users under 18 before you connect it.

## 3. Your AI proxy

The proxy is a small web service on your district's domain. It holds the provider key, admits classes by their class code, and forwards Amble's requests to the provider. It can be a small serverless function, an API gateway in front of Azure OpenAI (such as Azure API Management), or a self-hosted gateway such as LiteLLM. A proxy on your own domain is also easier to allow in your web filter than a provider's host.

### 3.1 What Amble sends to it

- `POST {base URL}/chat/completions`, in the OpenAI Chat Completions format, and `POST {base URL}/moderations` when moderation is set to `endpoint`. Amble uses no other endpoint. The base URL may include a path (such as `/v1`) and a query string, which Amble keeps at the end (for example Azure's `?api-version=`).
- Headers: `Content-Type: application/json`, plus your class-code header (`X-Amble-Class` unless you choose another) when you use class codes. Requests carry no cookies and no referrer.
- The body is a standard Chat Completions request. Depending on the capabilities you declare (section 4), it may include `stream: true` with `stream_options: {"include_usage": true}`, `response_format` (`json_schema` with `strict: true`, or `json_object`), `reasoning_effort`, `max_completion_tokens`, `store: false`, `safety_identifier`, and, for Magic bones, one `image_url` part with `detail: "low"`. If your endpoint rejects one of these with a 400 or 422 that names it, Amble drops it (or sends `max_tokens` instead of `max_completion_tokens`) and tries again.
- Streaming is optional. Amble reads server-sent events, and it also reads a plain JSON reply to a streaming request, which is what a filter that inspects and buffers HTTPS traffic tends to produce.
- The moderation call is `{"model": "omni-moderation-latest", "input": ...}` with one string or a list, and Amble reads OpenAI's result shape (`results[].flagged` and `results[].categories`). If `/moderations` answers 404, 405 or 501, Amble stops asking that endpoint and keeps using its own filter.

### 3.2 What the proxy must do

1. Answer CORS for Amble's origin only (for example `https://aboufama.github.io`, or your own domain), with the methods `POST, OPTIONS` and the headers `content-type` and your class-code header (for example `x-amble-class`).
2. Check the class code. Give each class its own code that expires each term. Changing a class's code switches that class off.
3. Enforce each class's AI mode (on, explain only, off) and content level on the server. A class link can be edited by a curious student, so what it says is a convenience, not the control.
4. Add the provider key, and strip the class-code header before calling the provider. Map model names such as `amble-default` to your deployment, cap token use, turn off provider tools such as web search, and keep `store: false`.
5. Limit requests per class. Answer `429` with `Retry-After` when a class is busy, and `403` with a quota code (`quota_exceeded` or `insufficient_quota`) when its daily budget is used up.
6. Allow long requests. Amble has no first-byte cutoff, and a build can take up to 10 minutes (section 3.4).
7. Log only what your privacy notice says. If staff may review request text, set `requestsMayBeReviewed` (section 4), so students see "Your school may review AI requests.", and say so in the letter to families.
8. Decide who sees self-harm or violence flags and what they do about them. Amble itself never notifies anyone (section 5).
9. Optionally, set the provider's `safety_identifier` yourself from a hash, or let Amble send its own (section 4), so a provider can act on one device instead of your whole account.

### 3.3 The replies Amble understands

| Your proxy answers | What Amble does | What the student sees |
|---|---|---|
| 200 with a Chat Completions reply, streamed or not | Uses it, after its checks and a robot test | The new version of the world |
| 400 with `error.code: "content_filter"` (or a message about a content filter), or `finish_reason: "content_filter"` | Treats it as a refusal | "Amble can't make that one. How about one of these?" with two ideas |
| 401, or 403 without a quota code | Stops | With class codes: "Your class link stopped working. Ask your teacher for a new one." |
| 403 with `quota_exceeded` or `insufficient_quota`, or a message about a quota or budget | Stops | "Your class used today's AI time. It comes back tomorrow. You can still draw and turn the Dials." |
| 429 | Retries up to 3 times, waiting for `Retry-After` when it is 60 seconds or less | "The AI helper is busy right now. Try again in a minute." |
| 408, 409, 425, 500, 502, 503, 504, 520 to 524, or 529 | Retries up to 3 times, with growing, randomized waits | "Amble couldn't make that work this time. Your world is just like before." |
| 413, or an error about the context length | Stops | "That change was too big for one go. Try a smaller step." |
| No reply within the job's time limit, or a streamed reply that stalls (section 3.4) | Stops | "The AI helper took too long to answer. Your world is just like before." |
| A network or CORS failure while the Chromebook is online | Retries up to 3 times | "Amble couldn't reach amble-ai.example.org. Your school's web filter may be blocking it. Everything else still works." |
| An HTML page instead of JSON (such as a filter's block page) | Stops | The same message about the web filter |
| Any other 4xx | Stops | "Amble couldn't make that work this time. Your world is just like before." |

Send errors as JSON in the OpenAI shape, `{"error": {"message": "...", "code": "..."}}`. When a request fails, the world stays as it was.

### 3.4 Timeouts

Amble has no first-byte limit, because district models can be slow to start. Each job has an overall limit, counted from when the request is sent:

| Job | Limit |
|---|---|
| Build a world | 10 minutes |
| Change a world | 7 minutes |
| Fix, resend or continue | 5 minutes |
| Plan a new world | 2 minutes |
| Explain, Magic bones | 90 seconds |
| Teacher desk and Settings connection test | 30 seconds |
| Moderation | 15 seconds |

Once a streamed reply has started, Amble drops it if no new data arrives for 90 seconds. Set your proxy's and gateway's timeouts above these limits.

## 4. Pointing Amble at your proxy

There are three ways for a school to point Amble at its proxy, plus manual settings for home use. Amble combines them in this order, highest first:

1. **ChromeOS managed configuration** (section 4.2)
2. **Build-time variables** in your own copy (section 4.3)
3. **A teacher's class link** (section 4.4)
4. **Manual settings**, for home use in the public copy (section 4.5)

How they combine (`src/ai/config/merge.ts`):

- The AI address, credential, models and capabilities come whole from the highest source that has an address. A class link adds its class code to a higher source's address only when both use the same origin.
- `lock` (from managed configuration or a build) stops lower sources from changing `ai` (the address, models and on or off), `content` (the content level) or `vision` (pictures).
- Any source can switch the AI helper off, unless a source above it locks `ai`. A teacher's class link can always lower its own class to explain only or off, but it can't switch on what the district switched off.
- Content level: the ceiling is the lowest `max` that any school source sets (`high` if none does). A class's level comes from its class link, otherwise from the build's default, otherwise from the managed default (`middle` if none), and never goes above the ceiling. An assignment can lower it again.
- Pictures (the Magic bones outline) are off unless a school source allows them, and every school source that sets the option must allow them.
- School mode (a build with `VITE_AMBLE_SCHOOL_MODE=true`, or any managed device) ignores manual settings and hides the manual setup in Settings.

### 4.1 Capabilities, moderation and the safety identifier

These three options appear in every method below.

- **Capabilities** say what your endpoint supports: `json_schema` (strict structured outputs), `stream` (streaming), `reasoning` (`reasoning_effort`), `vision` (image input; `images` also works) and `moderation` (a `/moderations` endpoint). Listed features are used and the others are not. Leave the option out, and Amble tries each feature and drops the ones your endpoint rejects; it then sends `reasoning_effort` only for model names that look like reasoning models (such as `gpt-5`). If you list capabilities and set moderation to `endpoint`, include `moderation`.
- **Moderation** is `endpoint` (Amble also calls `{base URL}/moderations`), `provider` (your endpoint filters requests itself) or `local-only` (Amble's own filter only). The default is `local-only`, except for OpenAI's own API address.
- **The safety identifier**, when you turn it on, is sent as `safety_identifier`: `amble_` followed by a SHA-256 hash of a random number kept on the Chromebook, salted with your AI origin and the date, so it changes every day. It is never made from anything about the student.

### 4.2 ChromeOS managed configuration

This is the zero-touch path: students never see a setting.

1. Force-install Amble as a web app (Chrome policy `WebAppInstallForceList`) at its address, for example `https://aboufama.github.io/amble/`.
2. Push a managed configuration for Amble's origin (policy `ManagedConfigurationPerOrigin`, or the Admin console). Amble reads it with `navigator.managed.getManagedConfiguration`, which works only for force-installed web apps on managed devices. Everywhere else Amble finds no configuration and moves on.
3. Amble reads the configuration when it starts, and again whenever you change it (Chrome's `managedconfigurationchange` event), so a new configuration takes effect in an open Amble without a restart. It wins over every other source, and a managed device counts as school mode unless the configuration says `"schoolMode": false`.

```json
{
  "amble": 1,
  "district": { "name": "Example School District", "privacyUrl": "https://www.example.org/amble-privacy", "contact": "tech@example.org" },
  "ai": {
    "enabled": true,
    "baseUrl": "https://amble-ai.example.org/v1",
    "model": "amble-default",
    "auth": { "type": "class-code", "header": "X-Amble-Class" },
    "moderation": "endpoint",
    "capabilities": ["json_schema", "stream", "moderation"],
    "allowArtToAI": false,
    "safetyIdentifier": true,
    "requestsMayBeReviewed": false,
    "gradeBandsWithAI": ["middle", "high"]
  },
  "content": { "max": "middle", "default": "middle" },
  "devices": { "shared": true },
  "lock": ["ai", "content"]
}
```

The same object may also sit under a top-level `"amble"` key.

| Field | Values | What it does |
|---|---|---|
| `district.name` | text | Your district's name, shown to students ("Your words go to Example School District's AI service") and on the privacy page |
| `district.privacyUrl` | https URL | Your own privacy notice, linked from Amble's privacy page |
| `district.contact` | text | A contact shown on the privacy page |
| `ai.enabled` | `true` or `false` | `false` switches the AI helper off |
| `ai.baseUrl` | https URL | Your proxy's OpenAI-compatible base URL. It must use https (http only for `localhost`) and hold no user name, password or key. |
| `ai.model` | text | The model name your proxy expects. Default `amble-default`. |
| `ai.fastModel`, `ai.visionModel` | text | The model for plans and explanations, and the one for Magic bones. Both default to `ai.model`. |
| `ai.auth.type` | `class-code` or `none` | `class-code`: students send a class code in a header. `none`: your proxy admits Amble without one. Any other value is ignored: keys are never accepted here. |
| `ai.auth.header` | header name | The class-code header. Default `X-Amble-Class`. |
| `ai.auth.code` | text | Optional. A district-wide code turns the AI helper on with no student steps, but then you can't switch one class off by changing its code. Without it, each class's code comes from its teacher's class link, and the AI helper turns on when a student joins. |
| `ai.moderation` | `endpoint`, `provider` or `local-only` | See section 4.1 |
| `ai.capabilities` | a list | See section 4.1 |
| `ai.allowArtToAI` | `true` or `false` | Allows Magic bones to send a drawing's outline. The student still says OK for each drawing. Default off. (`visionAllowed` is read too.) |
| `ai.safetyIdentifier` | `true` or `false` | Sends the safety identifier (section 4.1) |
| `ai.requestsMayBeReviewed` | `true` or `false` | Tells students "Your school may review AI requests." |
| `ai.gradeBandsWithAI` | a list of `elementary`, `middle`, `high` | The AI helper is on only for classes at these levels |
| `content.max` | `elementary`, `middle` or `high` | The highest content level any class may use |
| `content.default` | `elementary`, `middle` or `high` | The content level when no class link sets one |
| `devices.shared` | `true` or `false` | For shared carts: Amble reminds students every 30 minutes to save worlds with unsaved changes to Drive, and asks before a tab with unsaved work closes |
| `lock` | a list of `ai`, `content`, `vision` | What class links and manual settings can't change (`art` also means `vision`) |
| `schoolMode` | `true` or `false` | Default `true` on managed devices: no manual AI setup |

### 4.3 Build-time variables (your own copy)

A district can build its own copy from the source and host the `dist/` folder on any static web server over HTTPS (the service worker needs a secure page). The build uses relative paths, so any host and sub-path works.

```bash
npm ci
VITE_AMBLE_SCHOOL_MODE=true \
VITE_AMBLE_AI_BASE_URL=https://amble-ai.example.org/v1 \
VITE_AMBLE_AI_AUTH=class-code \
VITE_AMBLE_AI_MODERATION=endpoint \
VITE_AMBLE_CONTENT_MAX=middle \
VITE_AMBLE_LOCK=ai,content \
VITE_AMBLE_DISTRICT_NAME="Example School District" \
npm run build
```

The variables can also go in a `.env.production` file. Use `true` and `false` for yes-or-no values.

| Variable | Values | What it does |
|---|---|---|
| `VITE_AMBLE_SCHOOL_MODE` | `true` | A school build: no manual AI setup, and Amble's own sounds start off and games start muted |
| `VITE_AMBLE_AI_ENABLED` | `true` or `false` | `false` switches the AI helper off in this build |
| `VITE_AMBLE_AI_BASE_URL` | https URL | Your proxy. It also narrows the page's content security policy to that origin (below). |
| `VITE_AMBLE_AI_MODEL` | text | Default `amble-default` |
| `VITE_AMBLE_AI_FAST_MODEL`, `VITE_AMBLE_AI_VISION_MODEL` | text | Default: the main model |
| `VITE_AMBLE_AI_AUTH` | `class-code`, `none` or `user-key` | Read only when `VITE_AMBLE_AI_BASE_URL` is set. `class-code`: students join a teacher's class link, which supplies the code. `none` (or any other value): no credential. `user-key`: Settings → AI helper shows one key field (AI key, for grown-ups) for your address, and Amble sends that key only to your address. School copies (`VITE_AMBLE_SCHOOL_MODE=true`) never take a key, so don't combine the two. |
| `VITE_AMBLE_AI_AUTH_HEADER` | header name | Default `X-Amble-Class` |
| `VITE_AMBLE_AI_CAPS` | a comma list, for example `json_schema,stream,moderation` | See section 4.1 |
| `VITE_AMBLE_AI_MODERATION` | `endpoint`, `provider` or `local-only` | See section 4.1 |
| `VITE_AMBLE_AI_SAFETY_ID` | `true` or `false` | Sends the safety identifier (section 4.1) |
| `VITE_AMBLE_ALLOW_ART_TO_AI` | `true` or `false` | As `ai.allowArtToAI`. (`silhouette` also counts as `true`.) |
| `VITE_AMBLE_CONTENT_MAX` | `elementary`, `middle` or `high` | As `content.max` |
| `VITE_AMBLE_CONTENT_DEFAULT` | `elementary`, `middle` or `high` | As `content.default` |
| `VITE_AMBLE_AI_BANDS` | a comma list, for example `middle,high` | As `ai.gradeBandsWithAI` |
| `VITE_AMBLE_LOCK` | a comma list of `ai`, `content`, `vision` | As `lock` |
| `VITE_AMBLE_REQUESTS_REVIEWED` | `true` or `false` | As `ai.requestsMayBeReviewed` |
| `VITE_AMBLE_SHARED_DEVICES` | `true` or `false` | As `devices.shared` |
| `VITE_AMBLE_DISTRICT_NAME`, `VITE_AMBLE_PRIVACY_URL`, `VITE_AMBLE_CONTACT` | text, https URL, text | As `district.*`. The URL and the contact are used only when the name is set. |

Two things to know:

- Every `VITE_` value is compiled into the public JavaScript. Never put a key in one. The build stops if a `VITE_AMBLE_` value looks like a key or token (such as `sk-...`, a `Bearer` value, a JWT, a URL that carries a key, or a long random string), or if any `VITE_` variable's name says it holds one (`KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `PRIVATE`).
- With `VITE_AMBLE_AI_BASE_URL` set, the page's content security policy allows connections only to Amble's own origin and that AI origin. Class links or managed configurations that point at another AI host can't connect from that copy.

### 4.4 Class links

A class link hands a class its AI address and class code on devices without managed configuration. Teachers make them in the Teacher desk (`#/teacher/link`): an AI address (read-only when your district set one), a class code, the class's name, the AI helper (on, explain only or off), the content level, an optional assignment, and the date the link stops working (by default, the end of the current semester). The Teacher desk tests the address live, shows a QR code, and caps the AI mode and the level to your district's settings.

A link looks like this:

```text
https://aboufama.github.io/amble/#class=<payload>
```

The payload is the link's JSON, encoded as UTF-8 and then base64url without padding. The part after `#` never reaches the web host. When a student opens the link, Amble takes it out of the address bar at once and asks "Join Room 12 · Period 3?" (Join or Not now). A class the student joins stays on that Chromebook until someone presses Leave this class (Settings → AI helper).

This is the format the Teacher desk writes (`ClassLinkV1` in `src/model/types.ts`):

```json
{
  "v": 1,
  "cls": "Room 12 · Period 3",
  "district": "Example School District",
  "ai": {
    "baseUrl": "https://amble-ai.example.org/v1",
    "model": "amble-default",
    "auth": { "type": "class-code", "header": "X-Amble-Class", "code": "MAPLE-7Q2K" }
  },
  "mode": "on",
  "level": "middle",
  "exp": "2027-01-31",
  "asg": null
}
```

| Field | What it holds |
|---|---|
| `v` | Always `1` |
| `cls` | The class name students see (up to 40 characters). Required. |
| `district` | Your district's name, or `null`. The Join card shows "Class link from ..." |
| `ai` | `null` for a class without AI, or: `baseUrl` (https), `model` (required), optionally `fastModel`, `visionModel` and `caps` (a comma list, section 4.1), and `auth`, either `{"type": "class-code", "header": "X-Amble-Class", "code": "..."}` or `{"type": "none"}` |
| `mode` | `on`, `explain` (the AI helper only explains code) or `off`. Default `on`. |
| `level` | `elementary`, `middle` or `high`. Default `middle`. |
| `exp` | The last day the link works (`YYYY-MM-DD`, through the end of that day), or `null` for no end date |
| `asg` | An assignment, or `null`. The Teacher desk fills this in; keep it `null` in links you make yourself. |

To make links with your own tools, encode the JSON like this (Node.js):

```js
const url = 'https://aboufama.github.io/amble/#class=' + Buffer.from(JSON.stringify(link), 'utf8').toString('base64url');
```

Keep the encoded payload under 2 KB, the Teacher desk's limit.

Amble also reads the flat format that its AI core defines (`src/ai/config/classLink.ts`):

```text
https://<amble>/#class=<base64url({ v: 1, baseUrl, model, fastModel, visionModel, visionAllowed, code, header, name, district, policy })>
```

Here `policy` can hold `enabled`, `ageBand`, `caps`, `expires`, `moderation`, `lock`, `safetyIdentifier` and `requestsMayBeReviewed`. When a student joins, though, Amble converts the link to the Teacher desk's format and stores that, so only the address, the models, `caps`, `code` and `header`, `name`, `district`, `enabled`, `ageBand` and `expires` take effect. `visionAllowed`, `moderation`, `lock`, `safetyIdentifier` and `requestsMayBeReviewed` are dropped. Set those in managed configuration or your build instead.

Rules for every class link:

- Only https addresses work (http only for `localhost`).
- A link never carries a provider key. Amble won't make or open a link with a value that looks like one, or (in the flat format) with a field named like a credential. The student sees "This link doesn't look safe, so Amble ignored it."
- An expired link shows "This class link has expired. Ask your teacher for a new one. Amble still works without it."
- The Teacher desk's live test always sends the class code in `X-Amble-Class`. If you configure another header name, the teacher's test won't match what your proxy expects, even though students' requests use your header. Keep the default unless you have a reason not to.

### 4.5 Manual settings (home use)

In the public copy, Settings → AI helper → **Set up AI (for grown-ups)** takes a base URL (empty means OpenAI's API), an optional key, a model and a fast model, a Test connection button, and **Remember on this Chromebook** (off keeps the key only until the tab closes). Settings warns: "A key typed here can be read by anyone who uses this browser. Never type a school or paid key on a shared Chromebook." Manual settings are hidden in school builds, on managed devices, and whenever a school source provides the AI or locks it. A build with `VITE_AMBLE_AI_AUTH=user-key` shows only the key field, for the address the build set.

## 5. Moderation and safety

Your proxy and your provider's filters are the authority. Amble adds these layers, in order:

1. **The shape of the product.** The AI helper doesn't chat, has no name or face, and doesn't remember anyone. It only changes or explains a world.
2. **An on-device filter**, always on and offline, on the student's words before anything is sent. It stops:
   - crisis words (the crisis card below);
   - requests about attacks on schools, hate, extremism, sexual content, harassment, real people (such as "my teacher", or a first and last name next to hurtful words), drugs, games that collect personal information, and gambling;
   - personal information (section 1).

   It also adds tone-down notes for the class's content level.
3. **Your moderation endpoint**, when moderation is `endpoint`: the student's words before the request, and the words a new version of a game would show, in one batched call. Self-harm categories show the crisis card; sexual, hate, harassment and illicit categories show a refusal; graphic violence (and any violence at the elementary level) adds a tone-down note. Code is never sent to moderation, because game code is full of words like `kill()` and `shoot()`.
4. **The instructions.** Every request carries Amble's content policy and the class's content level (published at `#/ai`). The model can refuse, tone a request down, or signal a crisis.

   | | Elementary (grades 3-5) | Middle (grades 6-8, the default) | High (grades 9-12) |
   |---|---|---|---|
   | Fights | Bonk, bounce and tag; enemies poof into stars | Fantasy and sci-fi action, knockback, sparks | Action with hit flashes, no gore |
   | Things to throw or shoot | Water balloons, bubbles, snowballs, wands | Lasers, blasters, cartoon swords | Stylized weapons, never realistic real-world guns |
   | Losing | "Out" and "try again" | "Lose a life", "respawn" | "Game over" |
   | Scary | Spooky-cute only | Mildly spooky | Suspense, no gore |

5. **Provider and proxy signals.** A `content_filter` error or finish reason shows the refusal card, never technical text.
6. **An output check.** The words a new version of a game would show (titles, names, dialogue and the requests to draw) go through the on-device filter, and through moderation when it is on, before the student sees them. If something is flagged, Amble asks once more for kind words. If it is still flagged, Amble drops the change: "Amble made words that aren't OK for school, so it didn't use that change."
7. **In every game**, a flash limiter that game code can't turn off allows at most 3 full-screen flashes a second (2, and softer, with reduced motion).

A refusal shows "Amble can't make that one. How about one of these?" with two ideas chosen on the device. Refusals about real people add "Games about real people from your school or family aren't allowed, even as a joke." Footsteps records only that a request was refused ("refused: request"), never the words.

### The crisis card

When the on-device filter finds words that suggest a student may be in danger, Amble sends nothing. It shows this card instead of an answer:

> **It sounds like things might be really hard right now.**
>
> You deserve support. Please talk to a teacher, a counselor, or another adult you trust.
>
> In New Hampshire you can call or text 988, or call 1-833-710-6477 (NH Rapid Response, free, any time).

The card has **Read to me** (where the browser can read aloud) and **Back to my world**. The request isn't retried, and Footsteps records only "refused: support", never the words.

The same card appears when your moderation endpoint flags self-harm in the student's words, or when the model answers with its crisis signal. In those two cases the words did reach your endpoint.

Amble never notifies anyone. A crisis caught on the device never reaches your proxy. If your district wants staff to be alerted, decide that as policy, and build it at your proxy for the requests that reach it.

## 6. Web filters

Allow exactly these hosts, and nothing else:

| Host | For |
|---|---|
| The host that serves Amble: `aboufama.github.io` for the public copy, or your own copy's host | The app |
| Your AI proxy's host, for example `amble-ai.example.org` | The AI helper (only if you use it) |

- Allow the exact host names, not a wildcard such as `*.github.io`. Many filters treat `github.io` as a games or proxy category.
- Amble loads no fonts, scripts, images or analytics from anywhere else, and games can't reach the network at all.
- If your filter inspects HTTPS and buffers streamed replies, Amble still works. You can also leave `stream` out of the capabilities.
- When the AI host is blocked, students see "Amble couldn't reach amble-ai.example.org. Your school's web filter may be blocking it. Everything else still works." A teacher's live test in the Teacher desk says "Amble couldn't reach amble-ai.example.org. A web filter may be blocking it, or the address may be wrong."
- To check it yourself on a staff device: open Amble, open DevTools (F12, or Ctrl+Shift+I), choose the Network panel, and draw, play a starter world and open Settings. You will see requests to Amble's host and, when the AI helper is used, to your AI host. Nothing else. What Amble sends (`#/sent`) shows each AI request exactly as it was sent.

### Chrome policies that affect Amble

| Policy | What it means for Amble |
|---|---|
| `DeviceEphemeralUsersEnabled` | Wipes browser data at sign-out on shared carts. Students must save to Drive; set `devices.shared` so Amble reminds them. |
| `AllowFileSelectionDialogs` | If it is off, students can save and open files only as downloads. |
| `DefaultFileSystemWriteGuardSetting` | If it stops the save dialog, Amble saves a normal download instead. |
| `DownloadDirectory` | Point Downloads at Google Drive, and downloaded worlds land in Drive. |
| `WebAppInstallForceList` | Installs Amble with a launcher icon. Needed for managed configuration. |
| `ManagedConfigurationPerOrigin` | Pushes the AI and content settings in section 4.2. |
| `AudioCaptureAllowed` | If it is off, students can still pick and edit sounds, but not record them. |
| `DefaultCookiesSetting` | Blocking site data also stops Amble's storage. Amble then keeps work in memory and asks students to save files. |

## 7. Accessibility status

Amble aims to meet WCAG 2.1 AA, and WCAG 2.2 AA where it can. Its accessibility statement is at `#/accessibility`. Today:

- Everything works with a keyboard except freehand drawing strokes, which need a pointer. Shapes and Make it perfect draw lines and shapes from the keyboard, and joints in Bones move with the arrow keys.
- Controls have names for screen readers, saves and AI progress are announced, and the focus ring stays visible.
- There are Night, Day and High contrast themes (High contrast also follows forced colors), text up to 130%, extra spacing and easy-read letters. Menus, dialogs, settings and the in-app pages reflow at 400% zoom.
- Reduce motion follows the Chromebook or a setting in Amble. Single-key shortcuts can be turned off. Read to me uses on-device voices only.
- In games: the flash limiter, captions for sounds, a text copy of the score, lives and messages for screen readers, game speed at 100%, 75% or 50%, touch buttons, and Esc always leaves a game.
- Checked on every deploy (the CI gate runs `e2e/journeys/a11y.spec.ts`): axe-core finds no WCAG 2.1 A or AA problem on any screen or dialog, and the core flow (the Trail, a starter world, Change mode, a dial, Bones, a joint, Look inside, Run it, Hand in) works from the keyboard alone with visible focus.
- Known limits, from the statement: freehand drawing needs a mouse, pen or touch; drawings have names but no descriptions yet; the games students make may have gaps of their own.

Not done yet: there is no Accessibility Conformance Report (VPAT) yet, and this repository holds no record of a screen reader (ChromeVox) review or of testing on district Chromebooks, although the in-app statement lists ChromeVox passes among its checks.

## 8. The in-app pages

These pages are part of Amble, so they always match the version in use. The privacy notice, terms, AI instructions, IT page, family letter and accessibility statement show their version and date at the top. On the public copy they are at:

| Page | Address | What it holds |
|---|---|---|
| Privacy notice | <https://aboufama.github.io/amble/#/privacy> | A short version for students, then the full notice: what Amble keeps and where, every host it connects to, what it never does, the AI helper, who can see what, the choices students and families have, the laws it is built for, and security |
| Terms of use | <https://aboufama.github.io/amble/#/terms> | Who Amble is for, acceptable use, the AI helper, students' ownership of their work, and what districts may do |
| The AI helper's instructions | <https://aboufama.github.io/amble/#/ai> | The content policy and levels, what the AI helper receives, and the exact instructions every request starts with |
| Amble for IT | <https://aboufama.github.io/amble/#/it> | Hosts to allow, this copy's content security policy, managed configuration, build settings, what the proxy must do, provider guidance, Chrome policies, and how to check |
| Letter for families | <https://aboufama.github.io/amble/#/parents> | A letter filled in from the teacher's class: who provides the AI helper, what it sees, and how to ask for no AI |
| Accessibility | <https://aboufama.github.io/amble/#/accessibility> | The accessibility statement |
| Amble in 5 steps | <https://aboufama.github.io/amble/#/poster> | A poster for the classroom wall |
| What Amble sends | <https://aboufama.github.io/amble/#/sent> | This Chromebook's last 50 AI requests, exactly as sent |
| What's new | <https://aboufama.github.io/amble/#/whatsnew> | Changes in this version |

On your own copy, or after a move to a custom domain, replace the host.

## 9. Before the first class

The Teacher desk has a short "Ready for tomorrow?" list. For the district:

1. Allow the two hosts in your web filter (section 6).
2. Set up the proxy (section 3) and one way of pointing Amble at it (section 4).
3. On one student Chromebook: join a class link, ask for a small change in a starter world, and check the request in What Amble sends.
4. Try your actual model through your actual proxy. A whole new world can take minutes on a slow model, and the student draws while it builds.
5. Decide what staff do with safety flags at the proxy, and what your privacy notice and the letter for families say about AI logs.
6. Give teachers the poster (`#/poster`) and the letter for families (`#/parents`).

## 10. What Amble's owner still has to do

These items are for Amble's maintainer, and a district can reasonably ask about each one before a district-wide rollout:

1. **A custom domain for schools.** Every GitHub Pages site under `aboufama.github.io` is one web origin. They all share Amble's browser storage (worlds, settings and class codes), and they would all receive the same ChromeOS managed configuration. Many web filters also distrust `github.io`. Schools need an address that serves nothing but Amble, and the in-app pages' addresses change with it.
2. **A LICENSE.** The repository has no license file, so districts have no written permission to host their own copy, even though the in-app privacy notice calls Amble open source. It needs a license for the code and one for the starter worlds' art.
3. **A stable release channel.** Today `.github/workflows/pages.yml` publishes every push to the working branch and to `main` to the same address that schools would use. Schools need reviewed releases (for example from `main` or from tags, with release notes), the working branch on a separate preview address, two-factor sign-in on the owner's account, and workflow actions pinned to commit SHAs.
4. **A data privacy agreement through SDPC.** New Hampshire districts sign agreements through the NH Student Privacy Alliance (the Student Data Privacy Consortium), using the NH DPA or the national NDPA. Amble should offer to sign with Exhibit B marked "no student data", name a security contact, and post an Exhibit E general offer that any NH district can accept.
5. **An Accessibility Conformance Report (VPAT 2.5).** Under the DOJ's ADA Title II rule, districts must meet WCAG 2.1 AA (by April 26, 2027 where the population is 50,000 or more, as in Manchester and Nashua, and by April 26, 2028 elsewhere), and they ask vendors for an ACR now. It should cover the WCAG edition plus the Section 508 rows for authoring tools, backed by the automated tests and a manual ChromeVox review.
6. **A security contact.** A `SECURITY.md` with a private way to report a vulnerability. Today the privacy notice asks people to report security problems in a public GitHub issue.

Questions and problems: <https://github.com/aboufama/amble/issues>.
