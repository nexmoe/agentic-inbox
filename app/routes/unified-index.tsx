import { Navigate } from "react-router";

export default function UnifiedIndexRoute() {
	return <Navigate to="emails/inbox" replace />;
}
