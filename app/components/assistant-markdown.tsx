import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./chat-client.module.css";

export type AssistantMarkdownProps = {
  content: string;
};

const ALLOWED_ELEMENTS = [
  "p", "br", "strong", "em", "del", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "hr", "a", "code", "pre",
  "table", "thead", "tbody", "tr", "th", "td", "input", "img",
] as const;

function isSafeMarkdownUrl(value: string | undefined): value is string {
  if (!value) return false;
  if (value.startsWith("#")) return true;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

function safeUrlTransform(value: string): string {
  return isSafeMarkdownUrl(value) ? value : "";
}

function MarkdownLink({ href, children }: ComponentPropsWithoutRef<"a">) {
  if (!isSafeMarkdownUrl(href)) return <span>{children}</span>;
  const isExternal = href.startsWith("https://") || href.startsWith("http://");
  return (
    <a
      href={href}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
    >
      {children}
    </a>
  );
}

function OmittedImage({ alt }: ComponentPropsWithoutRef<"img">) {
  return <span className={styles.omittedImage} role="note">Imagen externa omitida{alt ? `: ${alt}` : "."}</span>;
}

export default function AssistantMarkdown({ content }: AssistantMarkdownProps) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        allowedElements={ALLOWED_ELEMENTS}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrlTransform}
        components={{
          h1: ({ children }) => <h2>{children}</h2>,
          h2: ({ children }) => <h3>{children}</h3>,
          h3: ({ children }) => <h4>{children}</h4>,
          h4: ({ children }) => <h4>{children}</h4>,
          h5: ({ children }) => <h4>{children}</h4>,
          h6: ({ children }) => <h4>{children}</h4>,
          a: MarkdownLink,
          img: OmittedImage,
          input: ({ type, checked }) => type === "checkbox"
            ? <input aria-label="Tarea" checked={Boolean(checked)} disabled readOnly type="checkbox" />
            : null,
          table: ({ children }) => (
            <div aria-label="Tabla de la respuesta" className={styles.tableWrapper} role="region" tabIndex={0}>
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
