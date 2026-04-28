import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

export type SplitTextOptions = {
  text: string;
  source?: string;
  chunkSize?: number;
  chunkOverlap?: number;
};

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_CHUNK_OVERLAP = 120;

export async function loadAndSplitTextDocuments(
  options: SplitTextOptions
): Promise<Document[]> {
  const normalized = options.text.trim();
  if (!normalized) {
    return [];
  }

  const source = options.source ?? "inline_text";
  const loader = new TextLoader(new Blob([normalized], { type: "text/plain" }));
  const loadedDocs = await loader.load();
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
    chunkOverlap: options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
  });

  const splitDocs = await splitter.splitDocuments(
    loadedDocs.map(
      (doc) =>
        new Document({
          pageContent: doc.pageContent,
          metadata: {
            ...doc.metadata,
            source,
          },
        })
    )
  );

  const chunkCount = splitDocs.length;
  return splitDocs.map(
    (doc, chunkIndex) =>
      new Document({
        pageContent: doc.pageContent,
        metadata: {
          ...doc.metadata,
          source,
          chunkIndex,
          chunkCount,
        },
      })
  );
}
