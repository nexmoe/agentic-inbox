import { useEffect, useState } from "react";
import api from "~/services/api";
import { getAttachmentUrl } from "~/lib/utils";
import type { Attachment } from "~/types";

const EMPTY_IMAGES: Readonly<Record<string, string>> = {};

function imageDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.onabort = () => reject(new DOMException("Aborted", "AbortError"));
		reader.readAsDataURL(blob);
	});
}

/** Read only this message's referenced CID attachments through authenticated API requests. */
export function useInlineEmailImages(body: string, mailboxId?: string, emailId?: string, attachments?: Attachment[]) {
	const messageKey = `${mailboxId ?? ""}/${emailId ?? ""}`;
	const [loaded, setLoaded] = useState<{ messageKey: string; body: string; images: Record<string, string> }>();
	useEffect(() => {
		const controller = new AbortController();
		if (!mailboxId || !emailId) return;
		const inline = (attachments ?? []).filter((attachment) => {
			const cid = attachment.content_id?.replace(/^<|>$/g, "");
			return attachment.disposition === "inline" && cid && body.toLowerCase().includes(`cid:${cid.toLowerCase()}`);
		});
		Promise.allSettled(inline.map(async (attachment) => {
			const blob = await api.getAttachment(mailboxId, emailId, attachment.id, { signal: controller.signal });
			if (!/^image\/(?:png|gif|jpe?g|webp|avif|bmp)$/i.test(blob.type)) throw new Error("Unsupported inline image");
			const data = await imageDataUrl(blob);
			return [getAttachmentUrl(mailboxId, emailId, attachment.id), data] as const;
		})).then((results) => {
			if (controller.signal.aborted) return;
			const images = Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
			setLoaded({ messageKey, body, images });
		});
		return () => controller.abort();
	}, [body, mailboxId, emailId, messageKey, attachments]);
	return loaded?.messageKey === messageKey && loaded.body === body ? loaded.images : EMPTY_IMAGES;
}
