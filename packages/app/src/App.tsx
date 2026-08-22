import { Route, Routes } from "react-router";

import { Project } from "./routes/Project";
import { Projects } from "./routes/Projects";
import { NotFound } from "./routes/NotFound";

export function App() {
	return (
		<Routes>
			<Route index element={<Projects />} />
			<Route path="p/:id" element={<Project />} />
			<Route path="*" element={<NotFound />} />
		</Routes>
	);
}
