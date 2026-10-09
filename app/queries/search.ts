// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useInfiniteQuery } from "@tanstack/react-query";
import { parseSearchQuery } from "~/lib/search-parser";
import api from "~/services/api";
import { queryKeys } from "./keys";
import { EMAIL_PAGE_SIZE, nextEmailPage, normalizeEmailPage } from "~/lib/email-pages";

export function useSearchEmails(mailboxId: string | undefined, query: string) {
	return useInfiniteQuery({
		queryKey: mailboxId && query
			? queryKeys.search.infinite(mailboxId, query)
			: ["search", "_disabled"],
		initialPageParam: 1,
		queryFn: async ({ pageParam, signal }) => {
			const parsed = parseSearchQuery(query);
			const params: Record<string, string> = {
				page: String(pageParam),
				limit: String(EMAIL_PAGE_SIZE),
			};
			if (parsed.query) params.query = parsed.query;
			if (parsed.from) params.from = parsed.from;
			if (parsed.to) params.to = parsed.to;
			if (parsed.subject) params.subject = parsed.subject;
			if (parsed.folder) params.folder = parsed.folder;
			if (parsed.date_start) params.date_start = parsed.date_start;
			if (parsed.date_end) params.date_end = parsed.date_end;
			if (parsed.is_read !== undefined)
				params.is_read = String(parsed.is_read);
			if (parsed.is_starred !== undefined)
				params.is_starred = String(parsed.is_starred);
			if (parsed.has_attachment) params.has_attachment = "true";

			return normalizeEmailPage(await api.searchEmails(mailboxId!, params, { signal }));
		},
		getNextPageParam: (lastPage, _pages, lastPageParam) => nextEmailPage(lastPage, lastPageParam),
		enabled: !!mailboxId && !!query,
	});
}
