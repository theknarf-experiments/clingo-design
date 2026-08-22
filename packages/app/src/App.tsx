import { Route, Routes } from "react-router";

import { Layout } from "./routes/Layout";
import { Home } from "./routes/Home";
import { About } from "./routes/About";
import { Solver } from "./routes/Solver";
import { NotFound } from "./routes/NotFound";

export function App() {
	return (
		<Routes>
			<Route element={<Layout />}>
				<Route index element={<Home />} />
				<Route path="solver" element={<Solver />} />
				<Route path="about" element={<About />} />
				<Route path="*" element={<NotFound />} />
			</Route>
		</Routes>
	);
}
