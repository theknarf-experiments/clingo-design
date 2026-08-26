/**
 * The panels' end of a length: what a field shows, and what a person typing
 * into one meant.
 *
 * Underneath the editor a length is EMU and nothing rounds — `emuOf` is exact
 * or nothing, and every stored literal carries the unit it was written in. A
 * field is where that meets a keyboard, and the two directions are not each
 * other's inverse, which is why they are two functions here rather than a
 * parse/format pair: {@link shownLength} rounds to what a unit is comfortable
 * reading, {@link typedLength} snaps to the nearest EMU there is, and only the
 * second one writes.
 *
 * Three questions, and the answers are deliberately not the same:
 *
 *   what a field displays  the *document's* unit. Set a document to millimetres
 *                          and the whole panel reads in millimetres, whatever
 *                          each value happens to be stored as — which is what
 *                          `Scene.unit` is for, and the only reading of "a
 *                          document measured in millimetres" a print designer
 *                          would accept.
 *   what a bare number     the document's unit, again — and this is the one
 *   means                  place the panel disagrees with `emuOf`, which reads
 *                          a bare number as pixels because that is what every
 *                          legacy literal in every stored document meant. A
 *                          field is a different context: the number is bare
 *                          because the unit is written on the label beside it.
 *   what a suffix means    itself. `12pt` typed into a millimetre document is
 *                          twelve points and is stored as `"12pt"`. The person
 *                          said which unit; overriding them would be the panel
 *                          arguing with the keyboard.
 *
 * The rounding is {@link nearestEmu}, and this module is the caller the unit
 * design allows it — the other is the migration. It is an editorial act and it
 * is visible: type `0.5px` and the value becomes 4763 EMU, half a pixel to the
 * nearest storable neighbour, which no CSS unit spells and which the document
 * therefore records as `"4763emu"` while the field goes on reading `0.5px`. A
 * spelling nobody has seen before is the honest half of that; a silently
 * dropped value would not be.
 */
import {
	DEFAULT_UNIT,
	type Emu,
	type Scene,
	UNITS,
	type Unit,
	displayLength,
	emuOf,
	formatLength,
	isUnit,
	nearestEmu,
} from "@clingo-design/design-core";

/**
 * The unit this document is read and written in.
 *
 * A document with no unit predates EMU and is in pixels — that absence is the
 * migration's format marker, so this asks for the field rather than the whole
 * scene: nothing here is entitled to a document that has been through
 * `normalizeScene`, and every panel that calls it has been.
 */
export const documentUnit = (scene: Pick<Scene, "unit">): Unit =>
	scene.unit ?? DEFAULT_UNIT;

/** What a field shows for a length already in hand. */
export const shownEmu = (emu: Emu, unit: Unit): string =>
	displayLength(emu, unit);

/**
 * What a field shows for a stored literal.
 *
 * Rounded to the unit's comfortable number of decimals, and so deliberately
 * *not* what is stored: a value spelled in one unit and read in another rarely
 * lands on a round number of the second — 24px is 6.35mm exactly, but 25px is
 * 6.6145833…mm and the field says `6.61458mm`. Untouched, the value keeps its
 * exact spelling; touched, what the field says becomes what the value is. That
 * is the bargain every design tool's unit menu makes, and it is the only one a
 * person can predict from looking at the screen.
 *
 * A literal that is not a length at all shows itself. Not a hole to plug: a
 * value can name a percentage, or predate the migration, and a field answering
 * `0mm` would be claiming the document says something it does not.
 */
export function shownLength(text: string, unit: Unit): string {
	const emu = emuOf(text);
	return emu === undefined ? text : shownEmu(emu, unit);
}

/** A length a person typed: what it comes to, and how to write it down. */
export interface TypedLength {
	emu: Emu;
	/**
	 * The document form — spelled in the unit they used if they used one, and
	 * in the document's otherwise, so a field is the one place a designer can
	 * change which unit a value is kept in.
	 */
	text: string;
}

/**
 * A number, then letters. Anything else — a percentage, a `calc()`, half a
 * number on the way to being one — falls off the end and is left to
 * {@link nearestEmu} to refuse, so there is one answer to "is this a length"
 * rather than two that can disagree.
 */
const SUFFIX = /^\s*[+-]?\d+(?:\.\d+)?\s*([A-Za-z]+)\s*$/;

/**
 * What a person typing into a length field said, or nothing at all.
 *
 * Nothing is the answer for text that is not a length yet — an empty field,
 * `12.`, `50%` — and the caller's job is then to leave the document alone,
 * which is what lets a field be edited a keystroke at a time without the
 * half-typed states reaching anyone else's screen.
 */
export function typedLength(input: string, unit: Unit): TypedLength | undefined {
	const said = SUFFIX.exec(input)?.[1].toLowerCase();
	// A suffix that is not a unit is not silently ignored: appending the
	// document's own to `12q` gives `12qmm`, which reads as no length, which is
	// the answer. Being wrong about the unit must not look like being right.
	const spelled = said !== undefined && isUnit(said) ? said : undefined;
	const emu = nearestEmu(spelled ? input : `${input}${UNITS[unit].symbol}`);
	if (emu === undefined) return undefined;
	return { emu, text: formatLength(emu, spelled ?? unit) };
}
