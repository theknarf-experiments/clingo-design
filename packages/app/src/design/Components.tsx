import { componentPath } from "@clingo-design/design-core";

import { deleteComponent, useComponents } from "../projects/store";
import styles from "./Components.module.css";

export interface ComponentsProps {
	url: string;
	/** The component being edited, when one is open rather than a page. */
	active?: string;
	/** Make a component out of what is selected, if anything is. */
	canExtract: boolean;
	onExtract: () => void;
	/** Open a component's own document to edit it. */
	onOpen?: (name: string) => void;
	/** Put an instance of one on the page being shown. */
	onPlace: (path: string) => void;
}

/**
 * The project's components, beside its pages.
 *
 * Each one is its own Automerge document, which is what puts it here rather
 * than in the layer list: a component does not belong to the page you happen to
 * be looking at. It belongs to the project, every page can use it, and editing
 * it from any of them changes it everywhere.
 *
 * So clicking one **opens** it: a component's document holds a scene, exactly as
 * a page's does, and the studio edits it with the same canvas, the same layer
 * list and the same undo stack. That is the whole of why editing a component
 * needed no editor of its own — the shape of the document decided it.
 *
 * Placing gets its own control rather than a double-click, and it is disabled
 * while a component is the thing open: an instance of a component inside its own
 * definition is a component that contains itself, and the compiler would ground
 * it until it ran out of room.
 */
export function Components({
	url,
	active,
	canExtract,
	onExtract,
	onOpen,
	onPlace,
}: ComponentsProps) {
	const names = useComponents(url);

	return (
		<section className={styles.host} data-role="components">
			<header className={styles.head}>
				<span className={styles.title}>Components</span>
				{/*
				  * Made from a selection rather than from nothing, because a component
				  * is a thing you have already drawn. The button is disabled rather
				  * than hidden when nothing is selected: it is the only route to a
				  * component, and a control that vanishes teaches nobody it exists.
				  */}
				<button
					type="button"
					className={styles.add}
					data-role="make-component"
					aria-label="Make a component from the selection"
					title={
						canExtract
							? "Move this into its own document. Every page can use it, and editing it changes them all."
							: "Select something to make a component of it"
					}
					disabled={!canExtract}
					onClick={onExtract}
				>
					+
				</button>
			</header>

			{names.length === 0 ? (
				<p className={styles.empty}>
					Nothing yet. Select something and press + to make it a component.
				</p>
			) : (
				<ul className={styles.list}>
					{names.map((name) => (
						<li key={name}>
							<div
								className={styles.row}
								data-component={name}
								data-active={name === active ? "" : undefined}
							>
								{/*
								  * Click opens it, and the arrow places one. That way round
								  * because a component is a document: clicking its name in a
								  * list of documents should show it, the way clicking a page
								  * does. Placing is the other verb and gets its own control
								  * rather than a double-click nobody discovers.
								  */}
								<button
									type="button"
									className={styles.name}
									data-role="open-component"
									title="Edit this component. Changes reach every use of it."
									onClick={() => onOpen?.(name)}
								>
									{name}
								</button>
								<button
									type="button"
									className={styles.place}
									data-role="place-component"
									aria-label={`Place an instance of ${name}`}
									title="Put an instance of it on the page you were on"
									disabled={active !== undefined}
									onClick={() => onPlace(componentPath(name))}
								>
									+
								</button>
								<button
									type="button"
									className={styles.remove}
									data-role="delete-component"
									aria-label={`Delete ${name}`}
									title="Delete this component. Instances of it stay where they are and stop drawing."
									onClick={() => {
										if (
											!confirm(
												`Delete “${name}”? Anything using it will stop drawing, but stays where it is.`,
											)
										) {
											return;
										}
										void deleteComponent(url, name);
									}}
								>
									×
								</button>
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
