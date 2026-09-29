/**
 * Patterns that need word order, not just words: attacks on schools, games that target real
 * people (cyberbullying, RSA 193-F), and hate against groups. They run on the folded views
 * (lowercase, single spaces, padded), except the name check, which needs capital letters.
 */

/** A regex alternation from ` | `-separated alternatives (inner groups like `(?:s|ed)` keep their own `|`). */
const alt = (words: string) => `(?:${words.trim().split(/\s+\|\s+/).join('|')})`;

const RELATION = alt(`classmates? | teachers? | principal | vice principal | counselor | coach | sisters? | brothers? | siblings? | mom | mum | mother |
  dad | father | parents? | stepmom | stepdad | stepmother | stepfather | grandma | grandpa | grandmother | grandfather | granny | nana |
  aunt | auntie | uncle | cousins? | friends? | best friend | bff | neighbou?rs? | babysitter | bus driver | lunch lady | crush | boyfriend |
  girlfriend | ex | classmates`);
const POSS = alt('my | our | his | her | their');
const ADJ = `(?:${alt(`little | big | older | younger | baby | step | best | stupid | dumb | annoying | mean | evil | fat | ugly | weird | new | old | real |
  math | science | english | art | gym | pe | music | homeroom`)} )*`;
const HURT = alt(`punch(?:es|ed|ing)? | kick(?:s|ed|ing)? | kill(?:s|ed|ing)? | shoot(?:s|ing)? | shot | stab(?:s|bed|bing)? | hit(?:s|ting)? |
  slap(?:s|ped|ping)? | beat(?:s|ing)? up | beat up | bull(?:y|ies|ied|ying) | hurt(?:s|ing)? | murder(?:s|ed|ing)? | destroy(?:s|ed|ing)? |
  explode(?:s|d)? | exploding | blow(?:s|ing)? up | blew up | burn(?:s|ed|ing)? | attack(?:s|ed|ing)? | smash(?:es|ed|ing)? | squash(?:es|ed|ing)? |
  crush(?:es|ed|ing)? | drown(?:s|ed|ing)? | poison(?:s|ed|ing)? | tortur(?:e|es|ed|ing) | eat(?:s|ing)? | ate | chop(?:s|ped|ping)? up |
  bomb(?:s|ed|ing)? | nuke(?:s|d)? | spit on | throw (?:rocks|things|stuff) at | laugh(?:s|ing)? at | make fun of | makes fun of |
  making fun of | mock(?:s|ed|ing)? | roast(?:s|ed|ing)? | humiliat(?:e|es|ed|ing) | embarrass(?:es|ed|ing)? | insult(?:s|ed|ing)? | prank(?:s|ed|ing)?`);
const TARGET = alt('boss | final boss | villain | bad guy | enemy | enemies | monster | target | zombie | loser | evil one');

/** Games that target, mock or star a real person the student knows. */
export const REAL_PERSON: readonly RegExp[] = [
  new RegExp(` ${HURT} (?:all )?(?:of )?${POSS} ${ADJ}${RELATION}(?:s)? `),
  new RegExp(` ${POSS} ${ADJ}${RELATION} (?:is|as|becomes|turns into|will be|should be|could be|gets to be) (?:the |a |an )?${ADJ}${TARGET} `),
  new RegExp(` ${TARGET} (?:is|looks like|will be|should be|could be) ${POSS} ${ADJ}${RELATION} `),
  new RegExp(` (?:about|starring|featuring|based on|named after|looks like|look like|looking like|put|add|include) ${POSS} ${ADJ}${RELATION} `),
  new RegExp(` with ${POSS} ${ADJ}${RELATION} (?:in it|as the|as a|as an) `),
  new RegExp(` ${POSS} ${ADJ}${RELATION} (?:dies|die|died|gets (?:killed|hurt|punched|shot|stabbed|hit|beat up|bullied|eaten|blown up)|explodes|blows up) `),
  new RegExp(` ${alt('kid | kids | boy | boys | girl | girls | student | students | person | people | someone | guy | dude | classmate')} (?:named [a-z]+ )?(?:in|from|at) (?:my|our) ${alt('class | school | grade | bus | team | homeroom')} `),
];

const SCHOOL = alt('school | high school | middle school | elementary school | elementary | classroom | class room | cafeteria | school bus');

/** Attacks on schools: refused absolutely, whatever the framing. */
export const SCHOOL_ATTACK: readonly RegExp[] = [
  / school shoot(?:ing|ings|er|ers|out) /,
  new RegExp(` ${alt(`shoot(?:s|ing)? up | shoot(?:s|ing)? | bomb(?:s|ed|ing)? | blow(?:s|ing)? up | blew up | stab(?:s|bed|bing)? |
    burn(?:s|ed|ing)? down | massacre | set fire to | shooting at | gun down`)} (?:up )?(?:the |my |our |a |this |that )?(?:real )?${SCHOOL} (?!of )`),
  new RegExp(` ${alt('kill | shoot | stab | bomb | murder')}(?:s|ed|ing)? (?:all )?(?:the |my |our )?(?:students|classmates|teachers|kids|everyone|everybody|people) (?:at|in) (?:my |our |the )?${SCHOOL} `),
  new RegExp(` (?:bring|brings|bringing|take|takes|taking) (?:a |my |the )?${alt('gun | guns | bomb | knife | weapon')} (?:to|into|at) ${SCHOOL} `),
];

const GROUPS = alt(`jews | jewish people | muslims | christians | black people | blacks | white people | asians | asian people | mexicans | immigrants |
  gays | gay people | lesbians | trans people | transgender people | disabled people | arabs | hispanics | latinos | africans | chinese people |
  refugees | catholics | hindus | sikhs`);

/** Violence or hate aimed at a group of people. */
export const HATE_GROUP: readonly RegExp[] = [
  new RegExp(` ${alt('kill | shoot | bomb | attack | destroy | hate | exterminate | gas | burn | hang | lynch | deport | wipe out')}(?:s|ed|ing)? (?:all )?(?:the )?${GROUPS} `),
  new RegExp(` ${GROUPS} ${alt('are evil | are bad | are stupid | are animals | should die | must die | deserve to die')} `),
];

/** Capitalized words that make a name pair fictional ("Moon King", "Captain Zoom"), not a real person's. */
const FICTION = new Set(
  (
    'King Queen Lord Lady Sir Captain Doctor Dr Professor Prof General Prince Princess Emperor Empress Baron Count Duke Master Boss Monster Dragon ' +
    'Robot Zombie Wizard Witch Knight Ninja Pirate Alien Space Moon Star Sun Shadow Dark Mega Super Ultra Giant Big Little Evil Mad Iron Fire Ice ' +
    'Thunder Slime Blob Ghost Skeleton Goblin Troll Orc Beast Bot Man Woman Girl Boy Kid Baby Lava Sky Sea Ocean Forest Castle Planet Galaxy ' +
    'The A An My Our Level World Game Player Hero Enemy Final Mister Miss Mr Mrs Ms Coach Team Red Blue Green Yellow Purple Pink Black White Golden ' +
    'Enter Key Bar Button Tab Shift Escape Esc Arrow Left Right Up Down Start Play Pause Stop Menu Mode Points Score'
  ).split(' '),
);
const HURT_WORDS = new Set(
  'punch punches punched kick kicks kicked kill kills killed shoot shoots shot stab stabs stabbed hit hits slap slaps slapped bully bullies bullied hurt hurts murder murders murdered destroy destroys destroyed explode attack attacks attacked smash smashes crush crushes drown drowns poison poisons torture tortures roast mock insult humiliate embarrass bomb nuke'.split(' '),
);
const HONORIFIC = /^(Mr|Mrs|Ms|Miss|Mx|Coach|Principal)\.?$/;

/**
 * A real-looking person's name next to a hurt word: "punch Jake Smith", "Jake Smith explodes",
 * "shoot Mr. Lee". Works on the original text, because it needs capital letters.
 */
export function namedTarget(text: string): string | null {
  const words = text.split(/[^A-Za-z.'-]+/).map((w) => w.replace(/^[.'-]+|[.'-]+$/g, '')).filter(Boolean);
  const isName = (w: string | undefined) => Boolean(w && /^[A-Z][a-z]+$/.test(w) && !FICTION.has(w));
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    if (HURT_WORDS.has(w)) {
      const [a, b] = [words[i + 1], words[i + 2]];
      if (a && HONORIFIC.test(a) && b && /^[A-Z][a-z]+$/.test(b)) return `${a} ${b}`;
      if (isName(a) && isName(b)) return `${a} ${b}`;
    }
    if (isName(words[i]) && isName(words[i + 1]) && /^(dies|explodes|gets)$/.test(words[i + 2] ?? '') && (i === 0 || !/^(the|a|an)$/i.test(words[i - 1]))) {
      return `${words[i]} ${words[i + 1]}`;
    }
  }
  return null;
}
