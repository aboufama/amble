/**
 * District builds: `VITE_AMBLE_*` variables set at build time (a fork, or a CI build for a district
 * origin). They are public, so they carry the endpoint and policy, never a key (see secrets.ts).
 *
 *   VITE_AMBLE_SCHOOL_MODE      true: hide manual keys and the dev bridge
 *   VITE_AMBLE_AI_ENABLED       false: no AI in this build
 *   VITE_AMBLE_AI_BASE_URL      https://amble-ai.sau99.org/v1
 *   VITE_AMBLE_AI_MODEL / _FAST_MODEL / _VISION_MODEL
 *   VITE_AMBLE_AI_AUTH          none | class-code | user-key
 *   VITE_AMBLE_AI_AUTH_HEADER   header for the class code (default X-Amble-Class)
 *   VITE_AMBLE_AI_CAPS          json_schema,stream,reasoning,images,moderation (listed = on)
 *   VITE_AMBLE_AI_MODERATION    endpoint | provider | local-only
 *   VITE_AMBLE_AI_SAFETY_ID     true: send a hashed, daily-rotated device id as safety_identifier
 *   VITE_AMBLE_ALLOW_ART_TO_AI  true | silhouette | drawing (vision allowed)
 *   VITE_AMBLE_CONTENT_MAX / _CONTENT_DEFAULT   elementary | middle | high
 *   VITE_AMBLE_AI_BANDS         the bands that get AI, e.g. middle,high
 *   VITE_AMBLE_LOCK             ai,content,vision
 *   VITE_AMBLE_REQUESTS_REVIEWED, VITE_AMBLE_SHARED_DEVICES   true | false
 *   VITE_AMBLE_DISTRICT_NAME, VITE_AMBLE_PRIVACY_URL, VITE_AMBLE_CONTACT
 */
import * as F from './fields';
import type { ConfigLayer } from './types';

export function layerFromEnv(env: Record<string, unknown>): ConfigLayer | null {
  const v = (name: string): unknown => env[`VITE_AMBLE_${name}`];
  const layer: ConfigLayer = { source: 'build', problems: [] };
  const problems = layer.problems as string[];

  layer.schoolMode = F.bool(v('SCHOOL_MODE'));
  layer.enabled = F.bool(v('AI_ENABLED'));
  const url = F.baseUrl(v('AI_BASE_URL'));
  if (url && 'problem' in url) problems.push(`VITE_AMBLE_AI_BASE_URL: ${url.problem}`);
  if (url && 'url' in url) {
    layer.baseUrl = url.url;
    const auth = F.str(v('AI_AUTH'))?.toLowerCase();
    const header = F.headerName(v('AI_AUTH_HEADER')) ?? F.DEFAULT_CLASS_HEADER;
    if (auth === 'class-code') layer.classCodeHeader = header;
    else if (auth === 'user-key') {
      layer.userKey = true;
      if (layer.schoolMode) problems.push('VITE_AMBLE_AI_AUTH=user-key: school copies never take a key, so the AI helper stays off. Use class-code or none.');
    } else layer.auth = { type: 'none' };
  }
  layer.model = F.str(v('AI_MODEL'), 120);
  layer.fastModel = F.str(v('AI_FAST_MODEL'), 120);
  layer.visionModel = F.str(v('AI_VISION_MODEL'), 120);
  layer.caps = F.caps(v('AI_CAPS'));
  layer.moderation = F.moderation(v('AI_MODERATION'));
  layer.safetyIdentifier = F.bool(v('AI_SAFETY_ID'));
  layer.visionAllowed = F.artToAi(v('ALLOW_ART_TO_AI'));
  layer.ageBandMax = F.band(v('CONTENT_MAX'));
  layer.ageBand = F.band(v('CONTENT_DEFAULT'));
  layer.aiBands = F.bands(v('AI_BANDS'));
  layer.lock = F.locks(v('LOCK'));
  layer.requestsMayBeReviewed = F.bool(v('REQUESTS_REVIEWED'));
  layer.sharedDevice = F.bool(v('SHARED_DEVICES'));
  const name = F.str(v('DISTRICT_NAME'));
  if (name) layer.district = { name, privacyUrl: F.httpsUrl(v('PRIVACY_URL')) ?? '', contact: F.str(v('CONTACT')) ?? '' };

  const used = Object.entries(layer).some(([k, val]) => k !== 'source' && k !== 'problems' && val !== undefined);
  return used || problems.length ? layer : null;
}
