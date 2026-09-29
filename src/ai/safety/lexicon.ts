/**
 * The local filter's word and phrase lists. Deliberately small: the district's proxy, the
 * moderation endpoint and the model's own instructions do the nuanced work; these catch what is
 * unambiguous, instantly and offline. Entries are whole words or phrases; `*` means any ending.
 *
 * Slurs, sexual terms and strong profanity are stored ROT13-encoded so the source doesn't display
 * them; `decode` turns them back into entries at load time.
 */
import { phraseRegex } from './normalize';

function decode(rot13: string): string[] {
  return rot13.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97)).split('|');
}

const SEXUAL = decode(
  'frk|frkl|frkhny|frkhnyyl|cbea*|ahqr|ahqrf|ahqvgl|anxrq|obbo*|cravf*|intvan*|qvyqb*|betnfz*|rebgvp*|srgvfu*|uragnv|afsj|encr|encrq|encrf|encvat|encvfg*|zbyrfg*|crqb|crqbf|crqbcuvyr*|cnrqbcuvyr*|ubbxre*|fgevccre*|cebfgvghg*|fgevc pyho*|oybjwbo*|oybj wbo*|unaqwbo*|unaq wbo*|ubeal|fyhg*|juber*|znxr ybir|znxvat ybir|unir frk|univat frk|frk fprar*|baylsnaf|phz|phzzvat|wrex bss|wrexvat bss|znfgheong*|zvys*|gubg|gubgf',
);
const SLURS = decode(
  'avttre*|avttn*|snttbg*|snt|sntf|ergneq|ergneqf|ergneqrq|fcvp|fcvpf|puvax*|xvxr*|jrgonpx*|genaal|genaavrf|qlxr*|tbbx*|enturnq*|gbjryurnq*|ornare*|cnxv|cnxvf|pbba|pbbaf|wnc|wncf|arteb*',
);
const PROFANITY = decode('shpx*|zbgures*|fuvg|fuvgf|fuvggl|fuvggvat|fuvgurnq*|ohyyfuvg|ovgpu*|phag*|nffubyr*|qvpxurnq*|gjng*|jnaxre*|jgs|fgsh');

/** First-person self-harm, suicide and distress. These show the crisis card and send nothing. */
const CRISIS = [
  'kill myself', 'killing myself', 'end my life', 'end it all', 'take my own life', 'take my life',
  'want to die', 'wanna die', 'want to be dead', 'wish i was dead', 'wish i were dead', 'wish i wasnt alive', 'wish i wasnt born',
  'dont want to live', 'dont want to be alive', 'dont want to exist', 'better off dead', 'better off without me',
  'no reason to live', 'nothing to live for', 'nobody would miss me', 'no one would miss me',
  'hurt myself', 'hurting myself', 'cut myself', 'cutting myself', 'harm myself', 'harming myself', 'starve myself', 'starving myself',
  'self harm', 'selfharm', 'suicide', 'suicidal', 'i hate myself', 'i hate my life',
  'nobody would care if i died', 'no one would care if i died', 'nobody cares about me', 'no one cares about me',
  'i want to disappear', 'i cant take it anymore', 'i dont want to be here anymore',
];

const EXTREMISM = [
  'nazi*', 'neo nazi*', 'neonazi*', 'swastika*', 'heil hitler', 'sieg heil', 'hitler', 'kkk', 'ku klux*', 'white power', 'white supremac*',
  'genocide', 'ethnic cleansing', 'holocaust', 'suicide bomb*', 'terrorist attack*', 'terror attack*', 'mass shooting*',
];

/** Drug use as the point of the game. Mentions alone only add a tone note (SUBSTANCES). */
const DRUG_USE = [
  'smoke weed', 'smoking weed', 'smokes weed', 'do drugs', 'doing drugs', 'does drugs', 'take drugs', 'taking drugs',
  'sell drugs', 'selling drugs', 'sells drugs', 'deal drugs', 'dealing drugs', 'get drunk', 'getting drunk', 'gets drunk', 'got drunk',
  'smoke crack', 'crack cocaine', 'snort coke', 'snorting coke', 'snort cocaine', 'shoot up heroin',
];

/** Telling someone to hurt themselves. */
const HARASSMENT = ['kill yourself', 'kill urself', 'kys', 'just go die', 'go die in a hole', 'neck yourself', 'unalive yourself'];

const GAMBLING = ['loot box*', 'lootbox*'];

/** Games that collect personal information or imitate a login. */
const PERSONAL_INFO = [
  'login screen', 'log in screen', 'login page', 'log in page', 'sign in page', 'sign in screen', 'fake login', 'phishing', 'credit card*',
  'enter your password', 'type your password', 'ask for their password', 'ask for your password', 'ask for their address', 'ask for your address',
  'ask for their phone number', 'ask for your phone number', 'collect their email*', 'collect email*',
];

const SUBSTANCES = [
  'beer', 'beers', 'wine', 'vodka', 'whiskey', 'whisky', 'tequila', 'booze', 'alcohol', 'drunk', 'liquor', 'cigarette*', 'vape', 'vapes', 'vaping', 'juul*',
  'marijuana', 'cannabis', 'cocaine', 'heroin', 'meth', 'fentanyl', 'lsd', 'mdma', 'drug', 'drugs',
];

const GORE = [
  'gore', 'gory', 'blood', 'bloody', 'bleed', 'bleeds', 'bleeding', 'guts', 'decapitat*', 'dismember*', 'behead*', 'disembowel*', 'entrails',
  'severed', 'mutilat*', 'gruesome', 'bloodbath', 'blood bath', 'torture', 'tortures', 'tortured', 'torturing',
];

const WEAPONS = [
  'gun', 'guns', 'pistol', 'pistols', 'rifle', 'rifles', 'shotgun*', 'machine gun*', 'handgun*', 'ak 47', 'ak47', 'ar 15', 'ar15', 'glock*', 'uzi', 'uzis', 'assault rifle*', 'grenade*',
];

/** Horror, never in elementary game text. */
const HORROR = ['horror', 'terrifying', 'jump scare*', 'jumpscare*', 'demon', 'demons', 'demonic', 'satan*', 'serial killer*', 'slasher*'];

/** Scary words in a request add a tone note; mild ones ("creepy crawlies") are fine in spooky-cute game text. */
const SCARY = [...HORROR, 'creepy', 'scary', 'scariest'];

/** Name-calling: never in game text at the elementary level. */
const INSULTS = ['stupid', 'idiot*', 'dumb', 'dumbass*', 'loser', 'losers', 'moron*', 'shut up', 'you suck'];

/**
 * Innocent phrases that contain listed words, removed before matching: game and science words
 * ("blood-red lava", "red blood cells"), animals, and toys.
 */
const ALLOWED = [
  'blood red', 'blood orange', 'blood moon', 'bloodhound', 'blood hound', 'blood type', 'blood cell', 'blood cells', 'blood bank', 'blood pressure',
  'bloodstream', 'cold blooded', 'warm blooded', 'naked mole', 'naked mole rat', 'naked eye', 'root beer', 'ginger beer', 'horny toad',
  'water gun', 'water guns', 'water pistol', 'water pistols', 'nerf gun', 'nerf guns', 'bubble gun', 'bubble guns', 'glue gun', 'foam gun', 'foam guns',
  'snowball gun', 'confetti gun', 'confetti cannon', 'rubbing alcohol', 'suicide squad', 'flame retardant',
];

export type LexiconCategory =
  | 'crisis'
  | 'sexual'
  | 'hate'
  | 'extremism'
  | 'drug-use'
  | 'harassment'
  | 'gambling'
  | 'personal-info'
  | 'profanity'
  | 'substances'
  | 'gore'
  | 'weapons'
  | 'scary'
  | 'horror'
  | 'insults';

const LISTS: Record<LexiconCategory, readonly string[]> = {
  crisis: CRISIS,
  sexual: SEXUAL,
  hate: SLURS,
  extremism: EXTREMISM,
  'drug-use': DRUG_USE,
  harassment: HARASSMENT,
  gambling: GAMBLING,
  'personal-info': PERSONAL_INFO,
  profanity: PROFANITY,
  substances: SUBSTANCES,
  gore: GORE,
  weapons: WEAPONS,
  scary: SCARY,
  horror: HORROR,
  insults: INSULTS,
};

const compiled = new Map<LexiconCategory, RegExp[]>();
let allowed: RegExp[] | null = null;

/** Removes innocent phrases (and, for the crisis list, "suicide bomber" and the like, which belong elsewhere). */
export function withoutAllowed(view: string, category: LexiconCategory): string {
  allowed ??= ALLOWED.map((p) => new RegExp(phraseRegex(p).source, 'g'));
  let out = view;
  for (const re of allowed) out = out.replace(re, ' ');
  if (category === 'crisis') out = out.replace(/ suicide (bomb[a-z]*|attack[a-z]*|mission[a-z]*|squad[a-z]*) /g, ' ');
  return out;
}

/** The first entry of a category found in any of the views, or null. */
export function findListed(views: readonly string[], category: LexiconCategory): string | null {
  let res = compiled.get(category);
  if (!res) {
    res = LISTS[category].map(phraseRegex);
    compiled.set(category, res);
  }
  for (const v of views) {
    const clean = withoutAllowed(v, category);
    for (const re of res) {
      const m = re.exec(clean);
      if (m) return m[0].trim();
    }
  }
  return null;
}
