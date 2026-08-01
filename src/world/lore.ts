/**
 * The written word: fragments found lying in the world, and the small cast of NPCs
 * standing in it. Pure content — no placement logic here, see `landmarks.ts` for how
 * a fragment or an NPC ends up at a particular x.
 *
 * Lines are authored short and pre-broken (one array entry per drawn line) rather
 * than left to wrap at render time: the renderer draws text literally, with no word
 * wrap, so the line breaks are an authoring decision, not a rendering one.
 */

export interface Fragment {
  id: string;
  title: string;
  lines: readonly string[];
}

export interface Npc {
  id: string;
  name: string;
  lines: readonly string[];
}

export const FRAGMENTS: readonly Fragment[] = [
  { id: 'torn-page', title: 'A Torn Page', lines: ['the dunes remember every step', 'even the ones you haven’t taken yet'] },
  { id: 'waystone', title: 'Waystone Marker', lines: ['seven roads met here once', 'now there is only sand'] },
  { id: 'childs-drawing', title: 'A Child’s Drawing', lines: ['a stick figure, arms wide', '“this is where the sky flipped”'] },
  { id: 'signpost', title: 'Weathered Signpost', lines: ['ahead: everything', 'behind: also everything'] },
  { id: 'pressed-flower', title: 'A Pressed Flower', lines: ['it bloomed facing backward', 'and never noticed'] },
  { id: 'tally-marks', title: 'Scratched Tally Marks', lines: ['someone counted the days here', 'they stopped at forty-one'] },
  { id: 'mirror-shard', title: 'A Cracked Mirror Shard', lines: ['it still shows what was', 'just a beat behind'] },
  { id: 'old-compass', title: 'An Old Compass', lines: ['the needle spins here', 'it isn’t lost — it’s listening'] },
  { id: 'folded-letter', title: 'A Folded Letter', lines: ['“if you’re reading this,”', '“you already know the way back”'] },
  { id: 'silent-chime', title: 'A Chime, Silent', lines: ['it never rang', 'it was just waiting for you'] },
  { id: 'carved-initials', title: 'Carved Initials', lines: ['two names, one arrow', 'pointing at nothing in particular'] },
  { id: 'faded-photo', title: 'A Photograph, Faded', lines: ['someone stood right here', 'and looked exactly as lost'] },
];

export const NPCS: readonly Npc[] = [
  {
    id: 'wanderer',
    name: 'The Wanderer',
    lines: [
      'the dunes keep changing their mind',
      'I stopped arguing with them years ago',
      'walk long enough — you’ll agree too',
    ],
  },
  {
    id: 'keeper',
    name: 'The Keeper',
    lines: [
      'welcome — rest if you need to',
      'the outpost doesn’t judge how far you’ve come',
      'or how far you have left',
    ],
  },
  {
    id: 'cartographer',
    name: 'The Cartographer',
    lines: [
      'I used to draw these dunes',
      'the map kept lying to me',
      'so now I just remember',
    ],
  },
  {
    id: 'quiet-child',
    name: 'A Quiet Child',
    lines: [
      'I found a mirror out there',
      'it showed me walking the other way',
      'I liked her better',
    ],
  },
  {
    id: 'the-echo',
    name: 'The Echo',
    lines: [
      'you’ll hear yourself before you see me',
      'that’s not an insult',
      'everyone does, out here',
    ],
  },
];

export function fragmentById(id: string): Fragment {
  const found = FRAGMENTS.find((fragment) => fragment.id === id);
  if (!found) throw new Error(`unknown fragment id: ${id}`);
  return found;
}

export function npcById(id: string): Npc {
  const found = NPCS.find((npc) => npc.id === id);
  if (!found) throw new Error(`unknown npc id: ${id}`);
  return found;
}
