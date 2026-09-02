import { CUSTOM_PROPERTY_RULES } from "@clingo-design/design-core";
import { Route, Routes } from "react-router";

import { Present } from "./routes/Present";
import { Project } from "./routes/Project";
import { Projects } from "./routes/Projects";
import { NotFound } from "./routes/NotFound";

export function App() {
	return (
		<>
			{/*
			  * The two custom properties a gradient is made of, registered — the same
			  * string `BASE_CSS` puts at the top of every exported file, out of the
			  * same constant in `paint.ts`, so the canvas and the file cannot
			  * disagree about what `--gfrom` starts at or whether it inherits.
			  *
			  * At the *app* root rather than the studio's, and that is the whole
			  * reason this component holds any markup of its own. `@property` is a
			  * global at-rule, so once anywhere in the document is enough — and the
			  * element mounted exactly once for every route is this one. A
			  * registration inside the studio would be absent from every route that
			  * does not render a studio, and the failure is invisible: the `var()`
			  * fallbacks inside every recipe mean a gradient still *paints*, while an
			  * unregistered custom property inherits — so a state that stopped
			  * repainting a gradient colour would take its parent's rather than the
			  * default's, and a keyframe on one would snap instead of tweening.
			  */}
			<style>{CUSTOM_PROPERTY_RULES}</style>
			<Routes>
				<Route index element={<Projects />} />
				{/*
				  * Two routes into one component, because a page is part of a project's
				  * address and not editor state. A link to a page opens that page — for
				  * a collaborator, for a bug report, for a browser's back button — and
				  * the bare form is the project's first page, so every url that worked
				  * before this existed still works.
				  */}
				<Route path="p/:id" element={<Project />} />
				<Route path="p/:id/:page" element={<Project />} />
				{/*
				  * A component is a document of the project like a page, so it gets an
				  * address like one. The extra segment is what keeps the two apart
				  * without forbidding anything: a page called "component" is still
				  * `/p/:id/component`, and only the three-segment form names a
				  * component — so no page name is unreachable.
				  */}
				<Route path="p/:id/component/:component" element={<Project />} />
				{/*
				  * A presentation is a *place*, not a state of the editor, and it names
				  * the page it is presenting for the reason the two routes above name
				  * theirs: it has to be a link somebody can be sent, and the back button
				  * has to be able to land on it.
				  *
				  * Three segments, exactly as a component's address is, and the
				  * reasoning there transfers unchanged: only the three-segment form is a
				  * presentation, so a page called "present" is still `/p/:id/present` and
				  * no page name becomes unreachable. The consequence worth stating is
				  * that "present the first page" has no address of its own — the button
				  * that enters resolves a page name first and navigates to the full form.
				  */}
				<Route path="p/:id/present/:page" element={<Present />} />
				<Route path="*" element={<NotFound />} />
			</Routes>
		</>
	);
}
