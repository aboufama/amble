import { describe, expect, it } from 'vitest';
import { assertNoKeyInEnv, findSecretsInEnv, looksLikeProviderKey, looksLikeSecret } from '../../src/ai/config/secrets';

// Fake credentials, built at runtime so no scanner mistakes this file for a leak.
const OPENAI = ['sk', 'proj', 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7cDe0f'].join('-');
const AZURE = '0f3a9c1e7b2d4f6a8c0e1b3d5f7a9c2e';
const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJhbWJsZSJ9', 'c2lnbmF0dXJlLXNpZ25hdHVyZQ'].join('.');

const district = {
  VITE_AMBLE_SCHOOL_MODE: 'true',
  VITE_AMBLE_AI_BASE_URL: 'https://amble-ai.sau99.org/v1',
  VITE_AMBLE_AI_MODEL: 'amble-default',
  VITE_AMBLE_AI_FAST_MODEL: 'gpt-4.1-mini-2025-04-14',
  VITE_AMBLE_AI_VISION_MODEL: 'Qwen2-VL-72B-Instruct-GPTQ-Int4',
  VITE_AMBLE_AI_AUTH: 'class-code',
  VITE_AMBLE_AI_AUTH_HEADER: 'X-Amble-Class',
  VITE_AMBLE_AI_CAPS: 'json_schema,stream',
  VITE_AMBLE_CONTENT_MAX: 'middle',
  VITE_AMBLE_LOCK: 'ai,content',
  VITE_AMBLE_DISTRICT_NAME: 'Souhegan Cooperative School District',
  VITE_AMBLE_PRIVACY_URL: 'https://www.sau39.org/amble/privacy-notice',
  VITE_AMBLE_CONTACT: 'tech@sau39.org',
  VITE_AMBLE_VERSION: '4b455dc2f8e1a9d7c3b5e6f0a1b2c3d4e5f6a7b8',
  VITE_SOMETHING_ELSE: 'unrelated',
  PATH: '/usr/bin',
};

describe('assertNoKeyInEnv', () => {
  it('passes a normal district build', () => {
    expect(() => assertNoKeyInEnv(district)).not.toThrow();
    expect(() => assertNoKeyInEnv({})).not.toThrow();
  });

  it('allows gateway ids in an endpoint path', () => {
    expect(findSecretsInEnv({ VITE_AMBLE_AI_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/amble/openai' })).toEqual([]);
  });

  it('fails a build that would publish a key, naming the variable but never the value', () => {
    const cases: Record<string, string>[] = [
      { VITE_AMBLE_AI_MODEL: OPENAI },
      { VITE_AMBLE_AI_AUTH_HEADER: `Bearer ${AZURE}` },
      { VITE_AMBLE_AI_CODE: AZURE },
      { VITE_AMBLE_AI_BASE_URL: `https://proxy.example.org/v1?api-key=${AZURE}` },
      { VITE_AMBLE_AI_BASE_URL: 'https://amble:hunter2@proxy.example.org/v1' },
      { VITE_AMBLE_CLASS: JWT },
      { VITE_OPENAI_API_KEY: 'anything' },
      { VITE_AMBLE_TOKEN: 'short' },
    ];
    for (const env of cases) {
      const [name, value] = Object.entries(env)[0];
      let message = '';
      try {
        assertNoKeyInEnv({ ...district, ...env });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, name).toContain(name);
      expect(message).not.toContain(value);
    }
  });

  it('lists every offending name', () => {
    expect(findSecretsInEnv({ VITE_AMBLE_AI_MODEL: OPENAI, VITE_API_KEY: 'x', VITE_AMBLE_OK: 'fine' })).toEqual(['VITE_AMBLE_AI_MODEL', 'VITE_API_KEY']);
  });
});

describe('looksLikeSecret', () => {
  it('catches key formats', () => {
    for (const v of [OPENAI, AZURE, JWT, 'AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvW', 'api_key=abc', `token: ${AZURE.slice(0, 10)}`, 'a1b2c3d4e5f6g7h8i9']) expect(looksLikeSecret(v), v).toBe(true);
    expect(looksLikeProviderKey(OPENAI)).toBe(true);
    expect(looksLikeProviderKey('MAPLE-7Q2K')).toBe(false);
  });

  it('leaves ordinary settings alone', () => {
    for (const v of ['amble-default', 'MAPLE-7Q2K', 'Room 12 · Period 3', 'https://amble-ai.sau99.org/v1', 'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'json_schema,stream,reasoning', 'X-Amble-Class', '']) {
      expect(looksLikeSecret(v), v).toBe(false);
    }
  });
});
