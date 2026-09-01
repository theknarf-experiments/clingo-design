import { Route, Routes } from "react-router";

import { Project } from "./routes/Project";
import { Projects } from "./routes/Projects";
import { NotFound } from "./routes/NotFound";

export function App() {
	return (
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
			<Route path="*" element={<NotFound />} />
		</Routes>
	);
}
