import { beforeEach, describe, expect, it } from 'vitest';
import type { AgeBand } from '../../src/ai/config/types';
import { AiError } from '../../src/ai/errors';
import { moderate, screenOutput, screenRequest, verdictFromCategories } from '../../src/ai/safety/moderation';
import { findPii, scrubPii } from '../../src/ai/safety/pii';
import { CRISIS_CARD, toneDownNote } from '../../src/ai/safety/policy';
import { checkOutputText, checkStudentText } from '../../src/ai/safety/screen';
import { forgetLearnedCaps } from '../../src/ai/wire/learned';
import { fakeEndpoint, never, transport } from './fakeEndpoint';

/** Offensive test words are written ROT13 so this file doesn't display them. */
const rot13 = (s: string) => s.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.toLowerCase().charCodeAt(0) - 97 + 13) % 26) + (c === c.toLowerCase() ? 97 : 65)));

const verdict = (text: string, band: AgeBand = 'middle') => checkStudentText(text, band);
const kind = (text: string, band: AgeBand = 'middle') => verdict(text, band).kind;

describe('normal game words are fine', () => {
  const fine = [
    'kill the slime',
    'a boss fight where you shoot lasers at the moon king',
    'drop a bomb that explodes into confetti',
    'blood-red lava that bubbles up from the floor',
    'zombies attack the school and I defend it with a leaf blower',
    'shoot hoops with my friends',
    'make a game for my little brother',
    "try to beat my brother's high score",
    'a game about my dog Max',
    'the hero dies when he falls in the pit',
    'I keep dying on the spikes, make them easier',
    'a naked mole rat racing game',
    'a wizard school where you shoot spells at dragons',
    'catch the school of fish before the shark does',
    'punch the Moon King until he pops',
    'hit Enter Key to jump and hit the ball with a bat',
    'the car goes 50 kms per hour',
    'a therapist robot who helps sad monsters',
    'a cocktail of fruit juice power-ups in Sussex',
    'make it 3x faster and shooting stars at night',
    'my class made a game about recycling',
    'score 1000000 points, jump 780 and gravity 1500',
    'a sniper duel in space with foam darts',
    'the pirates drink root beer and fire water guns',
    'when you stomp the goblins they go die in the lava',
  ];
  it.each(fine)('%s', (text) => {
    const v = verdict(text);
    expect(v.kind).toBe('allow');
    if (v.kind === 'allow') expect(v.toneDown.map((h) => h.topic).filter((t) => t === 'gore' || t === 'weapons')).toEqual([]);
  });
});

describe('the crisis path', () => {
  it.each(['i want to kill myself', "I don't want to live anymore", 'sometimes i want to die', 'i have been cutting myself', 'self-harm', 'i hate myself', 'i feel suicidal', 'I wanna die lol make a game'])(
    'shows the crisis card for "%s"',
    (text) => {
      const v = verdict(text);
      expect(v).toEqual({ kind: 'crisis', card: CRISIS_CARD });
    },
  );

  it('uses New Hampshire\'s numbers exactly', () => {
    expect(CRISIS_CARD.help).toBe('In New Hampshire you can call or text 988, or 1-833-710-6477 (NH Rapid Response, 24/7, free).');
    expect(CRISIS_CARD.contacts.map((c) => [c.number, c.call])).toEqual([
      ['988', 'tel:988'],
      ['1-833-710-6477', 'tel:+18337106477'],
    ]);
    expect(CRISIS_CARD.contacts[0].text).toBe('sms:988');
  });

  it('comes before any refusal, but leaves "suicide bomber" to the extremism rule', () => {
    expect(kind(`i want to die ${rot13('frkl')}`)).toBe('crisis');
    expect(verdict('a suicide bomber game')).toMatchObject({ kind: 'refuse', category: 'extremism' });
  });
});

describe('refusals', () => {
  const cases: Array<[string, string]> = [
    [`a ${rot13('frkl')} dance game`, 'sexual'],
    [`a game with ${rot13('anxrq')} people`, 'sexual'],
    [`a ${rot13('f r k l')} dance`, 'sexual'],
    [rot13('frkkkkl ynql'), 'sexual'],
    [`a ${rot13('f3kl')} dance`, 'sexual'],
    [`the enemies are ${rot13('snttbgf')}`, 'hate'],
    ['a game where we hate immigrants', 'hate'],
    ['a nazi zombie army', 'extremism'],
    ['a school shooting game', 'school-attack'],
    ['bring a gun to school', 'school-attack'],
    ['blow up my school', 'school-attack'],
    ['shoot up the high school', 'school-attack'],
    ['kill everyone at my school', 'school-attack'],
    ['punch my teacher in the face', 'real-person'],
    ['make fun of my stupid little sister', 'real-person'],
    ['my brother is the boss and you smash him', 'real-person'],
    ['the final boss looks like my math teacher', 'real-person'],
    ['a game about my classmate', 'real-person'],
    ['put my best friend in the game as a zombie', 'real-person'],
    ['the new kid in my class named Jake gets eaten', 'real-person'],
    ['punch Jake Smith', 'real-person'],
    ['shoot Mr. Lee with water', 'real-person'],
    ['make the boss say kill yourself', 'harassment'],
    ['when you lose it says just go die', 'harassment'],
    ['a game where you smoke weed', 'drugs'],
    ['sell drugs to get rich', 'drugs'],
    ['a fake login screen that asks for their password', 'personal-info'],
    ['add loot boxes to the shop', 'gambling'],
  ];
  it.each(cases)('refuses "%s" as %s', (text, category) => {
    const v = verdict(text);
    expect(v).toMatchObject({ kind: 'refuse', category });
    if (v.kind === 'refuse') {
      expect(v.message.length).toBeGreaterThan(10);
      expect(v.alternatives.length).toBeGreaterThan(0);
    }
  });

  it('explains real-person refusals in kid words', () => {
    expect(verdict('punch my teacher')).toMatchObject({ message: expect.stringMatching(/real people from your school or family/) });
  });
});

describe('toning down by age band', () => {
  it('adds notes for gore, guns, scary things, swearing and alcohol', () => {
    const topics = (text: string, band: AgeBand) => {
      const v = verdict(text, band);
      return v.kind === 'allow' || v.kind === 'pii' ? v.toneDown.map((h) => h.topic) : [];
    };
    expect(topics('zombies with lots of blood and guts', 'middle')).toEqual(['gore']);
    expect(topics('a game with guns', 'elementary')).toEqual(['weapons']);
    expect(topics('a water balloon fight', 'elementary')).toEqual([]);
    expect(topics('a creepy horror maze', 'elementary')).toEqual(['scary']);
    expect(topics('a creepy horror maze', 'high')).toEqual([]);
    expect(topics(`this is so ${rot13('shpxvat')} cool`, 'high')).toEqual(['language']);
    expect(topics('a pirate who drinks beer', 'middle')).toEqual(['substances']);
  });

  it('writes a band-specific note for the request', () => {
    const el = verdict('a game with guns', 'elementary');
    const hi = verdict('a game with guns', 'high');
    expect(el.kind === 'allow' && toneDownNote(el.toneDown)).toBe('Content notes for this request: No guns: use water balloons, bubbles, snowballs or magic wands.');
    expect(hi.kind === 'allow' && toneDownNote(hi.toneDown)).toBe('Content notes for this request: Stylized weapons only, never realistic real-world guns.');
    expect(toneDownNote([])).toBe('');
  });
});

describe('personal information', () => {
  it('finds emails, phone numbers, addresses, names, birthdays and schools', () => {
    const text = 'my name is Jake Smith, email jake.s@example.com, call (603) 555-0199 or 603-555-0100. I live at 12 Maple Street. my birthday is May 3. I go to Hollis Brookline Middle School';
    expect(findPii(text).map((p) => p.kind)).toEqual(['name', 'email', 'phone', 'phone', 'address', 'birthday', 'school']);
    expect(scrubPii('email me at jake@example.com please')).toBe('email me at [removed] please');
  });

  it("doesn't mistake game numbers for phone numbers", () => {
    expect(findPii('score 1000000 points, jump 780, gravity 1500, level 2-3, spawn 3 enemies on the road every 1200 ms')).toEqual([]);
  });

  it('blocks at the elementary level and warns above it', () => {
    expect(verdict('my email is kid@example.com', 'elementary')).toMatchObject({ kind: 'pii', block: true });
    expect(verdict('my email is kid@example.com', 'middle')).toMatchObject({ kind: 'pii', block: false, message: expect.stringMatching(/Remove it\?/) });
  });
});

describe('text the game will show', () => {
  it('passes normal game text and flags what is not OK, by band', () => {
    const texts = ['YOU WIN!', 'Game over, loser!', `Now ${rot13('fuvg')} happens`, 'Blood everywhere!', 'Call 603-555-0100 for help', 'kill yourself', 'Kill 10 slimes!'];
    const el = checkOutputText(texts, 'elementary');
    expect(el.flagged.map((f) => [f.index, f.category])).toEqual([
      [1, 'insult'],
      [2, 'profanity'],
      [3, 'gore'],
      [4, 'personal-info'],
      [5, 'self-harm'],
    ]);
    const hi = checkOutputText(texts.map((text) => ({ text })), 'high');
    expect(hi.flagged.map((f) => f.index)).toEqual([2, 4, 5]);
    expect(checkOutputText(['Slime Party', 'Draw your hero', 'Bonk the blobs!'], 'elementary')).toEqual({ ok: true, flagged: [] });
  });

  it('lets spooky-cute text through at the elementary level, but not horror', () => {
    expect(checkOutputText(['A not-so-scary ghost', 'Creepy Crawlies', 'Spooky Mansion'], 'elementary')).toEqual({ ok: true, flagged: [] });
    expect(checkOutputText(['Jump scare incoming!', 'The Demon King'], 'elementary').flagged.map((f) => f.category)).toEqual(['scary', 'scary']);
    expect(checkOutputText(['The Demon King'], 'middle').ok).toBe(true);
  });
});

describe('the moderation endpoint', () => {
  beforeEach(() => forgetLearnedCaps());
  const flagged = (categories: string[]) => ({ results: [{ flagged: categories.length > 0, categories: Object.fromEntries(categories.map((c) => [c, true])) }] });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('posts the inputs and reads the flagged categories', async () => {
    const ep = fakeEndpoint([json({ results: [{ flagged: true, categories: { harassment: true, violence: false } }, { flagged: false, categories: {} }] })]);
    const r = await moderate(transport(ep.fetch), ['one', 'two']);
    expect(r).toEqual({ checked: true, results: [{ flagged: true, categories: ['harassment'] }, { flagged: false, categories: [] }] });
    expect(ep.sent[0].url).toBe('https://ai.example.org/v1/moderations');
    expect(ep.sent[0].body).toEqual({ model: 'omni-moderation-latest', input: ['one', 'two'] });
  });

  it('remembers an endpoint without /moderations and carries on locally', async () => {
    const ep = fakeEndpoint([json({ error: { message: 'Not found' } }, 404)]);
    expect(await moderate(transport(ep.fetch), ['x'])).toEqual({ checked: false, results: [] });
    expect(await moderate(transport(ep.fetch), ['x'])).toEqual({ checked: false, results: [] });
    expect(ep.sent).toHaveLength(1);
    const down = fakeEndpoint([() => Promise.reject(new TypeError('Failed to fetch'))]);
    expect((await moderate(transport(down.fetch), ['x'])).checked).toBe(false);
  });

  it('maps categories to the crisis card, refusals or tone notes', () => {
    expect(verdictFromCategories(['self-harm/intent'], 'middle').kind).toBe('crisis');
    expect(verdictFromCategories(['sexual/minors'], 'high')).toMatchObject({ kind: 'refuse', category: 'sexual' });
    expect(verdictFromCategories(['harassment/threatening'], 'high')).toMatchObject({ kind: 'refuse', category: 'harassment' });
    expect(verdictFromCategories(['violence/graphic', 'violence'], 'elementary')).toMatchObject({ kind: 'allow', toneDown: [{ topic: 'gore' }, { topic: 'violence' }] });
    expect(verdictFromCategories(['violence'], 'high')).toEqual({ kind: 'allow', toneDown: [] });
  });

  it('screens a request locally first, and asks the endpoint only when configured', async () => {
    const ep = fakeEndpoint([json(flagged(['self-harm/intent'])), json(flagged(['violence/graphic']))]);
    const t = transport(ep.fetch);
    expect(await screenRequest('punch my teacher', { band: 'middle', moderation: 'endpoint', transport: t })).toMatchObject({ kind: 'refuse' });
    expect(ep.sent).toHaveLength(0);
    expect(await screenRequest('make it all go away forever', { band: 'middle', moderation: 'endpoint', transport: t })).toMatchObject({ kind: 'crisis' });
    expect(await screenRequest('an explosion of slime', { band: 'high', moderation: 'endpoint', transport: t })).toMatchObject({ kind: 'allow', toneDown: [{ topic: 'gore' }] });
    expect(await screenRequest('an explosion of slime', { band: 'high', moderation: 'local-only', transport: t })).toEqual({ kind: 'allow', toneDown: [] });
    expect(ep.sent).toHaveLength(2);
  });

  it('screens game text in one batched call', async () => {
    const ep = fakeEndpoint([json({ results: [{ flagged: false, categories: {} }, { flagged: true, categories: { 'hate/threatening': true } }] })]);
    const r = await screenOutput(['YOU WIN!', 'a line the local lists miss'], { band: 'middle', moderation: 'endpoint', transport: transport(ep.fetch) });
    expect(r).toEqual({ ok: false, moderated: true, flagged: [{ index: 1, text: 'a line the local lists miss', category: 'hate' }] });
    expect(ep.sent).toHaveLength(1);
  });

  it('cancels with the caller', async () => {
    const ctl = new AbortController();
    const p = moderate(transport(fakeEndpoint([never]).fetch), ['x'], { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toBeInstanceOf(AiError);
  });
});

describe('speed', () => {
  it('screens a request in well under a millisecond on average', () => {
    const text = 'make a platformer where a space kid pops grumpy moon rocks with a bubble wand, then fights the Moon King in three phases with lasers';
    checkStudentText(text, 'middle');
    const start = performance.now();
    for (let i = 0; i < 200; i++) checkStudentText(text, 'middle');
    expect((performance.now() - start) / 200).toBeLessThan(5);
  });
});
