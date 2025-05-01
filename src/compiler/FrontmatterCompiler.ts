import { FrontMatterCache, getLinkpath, MetadataCache } from "obsidian";
import {
	getGardenPathForNote,
	sanitizePermalink,
	generateUrlPath,
	kebabize,
	getRewriteRules,
} from "../utils/utils";
import DigitalGardenSettings from "../models/settings";
import { PathRewriteRules } from "../repositoryConnection/DigitalGardenSiteManager";
import { PublishFile } from "../publishFile/PublishFile";
import * as path from "path";
import { DateTime } from "luxon";
import * as yaml from "js-yaml";

export type TFrontmatter = Record<string, unknown> & {
	"dg-path"?: string;
	"dg-permalink"?: string;
	"dg-home"?: boolean;
	"dg-hide-in-graph"?: boolean;
	"dg-hide"?: boolean;
	"dg-pinned"?: boolean;
	"dg-metatags"?: string;
	tags?: string;
	category?: string;
	score?: number;
	updated?: Date;
	published?: Date;
};

export type TPublishedFrontMatter = Record<string, unknown> & {
	tags?: string[];
	metatags?: string;
	pinned?: boolean;
	permalink?: string;
	hide?: boolean;
	category?: string;
	score?: number;
	updated?: Date;
	published?: Date;
};

export class FrontmatterCompiler {
	private readonly settings: DigitalGardenSettings;
	private readonly rewriteRules: PathRewriteRules;
	private readonly metadataCache: MetadataCache;

	constructor(settings: DigitalGardenSettings, metadataCache: MetadataCache) {
		this.settings = settings;
		this.rewriteRules = getRewriteRules(settings.pathRewriteRules);
		this.metadataCache = metadataCache;
	}

	compile(file: PublishFile, frontmatter: FrontMatterCache): string {
		const fileFrontMatter = { ...frontmatter };
		delete fileFrontMatter["position"];

		let publishedFrontMatter: TPublishedFrontMatter = {
			"blog-publish": true,
		};

		publishedFrontMatter = this.addPermalink(
			fileFrontMatter,
			publishedFrontMatter,
			file.getPath(),
		);

		publishedFrontMatter = this.addDefaultPassThrough(
			file,
			fileFrontMatter,
			publishedFrontMatter,
		);

		publishedFrontMatter = this.addContentClasses(
			fileFrontMatter,
			publishedFrontMatter,
		);

		publishedFrontMatter = this.addPageTags(
			fileFrontMatter,
			publishedFrontMatter,
		);

		publishedFrontMatter = this.addFrontMatterSettings(
			fileFrontMatter,
			publishedFrontMatter,
		);

		publishedFrontMatter = this.addNoteIconFrontMatter(
			fileFrontMatter,
			publishedFrontMatter,
		);

		publishedFrontMatter =
			this.addTimestampsFrontmatter(file)(publishedFrontMatter);

		const fullFrontMatter = publishedFrontMatter?.dgPassFrontmatter
			? { ...fileFrontMatter, ...publishedFrontMatter }
			: publishedFrontMatter;

		// Convert the frontmatter object to YAML format
		const frontMatterString = yaml.dump(fullFrontMatter, {
			indent: 2,
			quotingType: '"',
			lineWidth: -1, // Prevent line wrapping
		});

		return `---\n${frontMatterString}---\n`;
	}

	private addPermalink(
		baseFrontMatter: TFrontmatter,
		newFrontMatter: TPublishedFrontMatter,
		filePath: string,
	) {
		const publishedFrontMatter = { ...newFrontMatter };

		const gardenPath =
			baseFrontMatter && baseFrontMatter["dg-path"]
				? baseFrontMatter["dg-path"]
				: getGardenPathForNote(filePath, this.rewriteRules);

		if (gardenPath != filePath) {
			publishedFrontMatter["dg-path"] = gardenPath;
		}

		if (baseFrontMatter && baseFrontMatter["dg-permalink"]) {
			publishedFrontMatter["dg-permalink"] =
				baseFrontMatter["dg-permalink"];

			publishedFrontMatter["permalink"] = sanitizePermalink(
				baseFrontMatter["dg-permalink"],
			);
		} else {
			publishedFrontMatter["permalink"] =
				"/" + generateUrlPath(gardenPath, this.settings.slugifyEnabled);
		}

		return publishedFrontMatter;
	}

	private addDefaultPassThrough(
		file: PublishFile,
		baseFrontMatter: TFrontmatter,
		newFrontMatter: TPublishedFrontMatter,
	) {
		// Eventually we will add other pass-throughs here. e.g. tags.
		const publishedFrontMatter = { ...newFrontMatter };

		if (baseFrontMatter) {
			if (baseFrontMatter["title"]) {
				publishedFrontMatter["title"] = baseFrontMatter["title"];
			} else {
				// Add default title from file name if not present
				const fileName = path.basename(file.getPath());
				publishedFrontMatter["title"] = fileName.replace(/\.md$/, "");
			}

			if (baseFrontMatter["dg-metatags"]) {
				publishedFrontMatter["metatags"] =
					baseFrontMatter["dg-metatags"];
			}

			if (baseFrontMatter["dg-hide"]) {
				publishedFrontMatter["hide"] = baseFrontMatter["dg-hide"];
			}

			if (baseFrontMatter["dg-hide-in-graph"]) {
				publishedFrontMatter["hideInGraph"] =
					baseFrontMatter["dg-hide-in-graph"];
			}

			if (baseFrontMatter["dg-pinned"]) {
				publishedFrontMatter["pinned"] = baseFrontMatter["dg-pinned"];
			}

			// Handle category - use folder name if not specified in frontmatter
			if (baseFrontMatter["category"]) {
				publishedFrontMatter["category"] = baseFrontMatter["category"];
			} else {
				const folderPath = file.getPath().split("/");

				if (folderPath.length > 1) {
					publishedFrontMatter["category"] = folderPath[0];
				}
			}

			// Handle score if present in frontmatter
			if (baseFrontMatter["score"] !== undefined) {
				publishedFrontMatter["score"] = baseFrontMatter["score"];
			}

			// Handle published and updated timestamps
			if (baseFrontMatter["published"] !== undefined) {
				publishedFrontMatter["published"] = new Date(
					baseFrontMatter["published"],
				);
			}

			if (baseFrontMatter["updated"] !== undefined) {
				publishedFrontMatter["updated"] = new Date(
					baseFrontMatter["updated"],
				);
			}

			if (baseFrontMatter["blog-publish"] !== undefined) {
				publishedFrontMatter["draft"] =
					!baseFrontMatter["blog-publish"];
			}

			//TODO: Add Auto Banner

			// Banner: resolve wiki link and normalize path, then assign to 'image'
			if (baseFrontMatter["banner"]) {
				const rawBanner = baseFrontMatter["banner"] as string;
				const wikiImgRegex = /!\[\[(.*?)\]\]/;
				const match = rawBanner.match(wikiImgRegex);
				const bannerPath = match ? match[1] : rawBanner;

				const normalizePath = (p: string) =>
					p.replace(/\\/g, "/").replace(/\s+/g, "-");

				if (match) {
					const linkedFile = this.metadataCache.getFirstLinkpathDest(
						getLinkpath(bannerPath),
						file.getPath(),
					);

					if (linkedFile) {
						const noteDir = path.dirname(file.getPath());

						const relativePath = path.relative(
							noteDir,
							linkedFile.path,
						);

						publishedFrontMatter["image"] =
							normalizePath(relativePath);
					}
				} else {
					const noteDir = path.dirname(file.getPath());
					const relativePath = path.relative(noteDir, bannerPath);
					publishedFrontMatter["image"] = normalizePath(relativePath);
				}
			}
		}

		return publishedFrontMatter;
	}

	private addPageTags(
		fileFrontMatter: TFrontmatter,
		publishedFrontMatterWithoutTags: TPublishedFrontMatter,
	) {
		const publishedFrontMatter = { ...publishedFrontMatterWithoutTags };

		if (fileFrontMatter) {
			const tags =
				(typeof fileFrontMatter["tags"] === "string"
					? fileFrontMatter["tags"].split(/,\s*/)
					: fileFrontMatter["tags"]) || [];

			if (fileFrontMatter["dg-home"] && !tags.contains("gardenEntry")) {
				tags.push("gardenEntry");
			}

			if (tags.length > 0) {
				publishedFrontMatter["tags"] = tags;
			}
		}

		return publishedFrontMatter;
	}

	private addContentClasses(
		baseFrontMatter: TFrontmatter,
		newFrontMatter: TPublishedFrontMatter,
	) {
		const publishedFrontMatter = { ...newFrontMatter };

		if (baseFrontMatter) {
			const contentClassesKey = this.settings.contentClassesKey;
			const contentClasses = baseFrontMatter[contentClassesKey];

			if (contentClassesKey && contentClasses) {
				if (typeof contentClasses == "string") {
					publishedFrontMatter["contentClasses"] = contentClasses;
				} else if (Array.isArray(contentClasses)) {
					publishedFrontMatter["contentClasses"] =
						contentClasses.join(" ");
				} else {
					publishedFrontMatter["contentClasses"] = "";
				}
			}
		}

		return publishedFrontMatter;
	}

	/**
	 * Adds the created and updated timestamps to the compiled frontmatter if specified in user settings
	 */
	private addTimestampsFrontmatter =
		(file: PublishFile) => (newFrontMatter: TPublishedFrontMatter) => {
			const {
				showCreatedTimestamp,
				showUpdatedTimestamp,
				createdTimestampKey,
				updatedTimestampKey,
				timestampFormat,
			} = this.settings;

			// Created timestamp
			if (showCreatedTimestamp) {
				const createdKey = createdTimestampKey;

				if (!file.frontmatter[createdKey]) {
					const created = DateTime.fromMillis(
						file.file.stat.ctime,
					).toFormat(timestampFormat);
					newFrontMatter[createdKey] = new Date(created);
				}
			}

			// Updated timestamp
			if (showUpdatedTimestamp) {
				const updatedKey = updatedTimestampKey;

				if (!file.frontmatter[updatedKey]) {
					const updated = DateTime.fromMillis(
						file.file.stat.mtime,
					).toFormat(timestampFormat);
					newFrontMatter[updatedKey] = new Date(updated);
				}
			}

			return newFrontMatter;
		};

	private addNoteIconFrontMatter(
		baseFrontMatter: TFrontmatter,
		newFrontMatter: TPublishedFrontMatter,
	) {
		if (!baseFrontMatter) {
			baseFrontMatter = {};
		}

		//If all note icon settings are disabled, don't change the frontmatter, so that people won't see all their notes as changed in the publication center
		if (
			!this.settings.showNoteIconInFileTree &&
			!this.settings.showNoteIconOnInternalLink &&
			!this.settings.showNoteIconOnTitle &&
			!this.settings.showNoteIconOnBackLink
		) {
			return newFrontMatter;
		}

		const publishedFrontMatter = { ...newFrontMatter };
		const noteIconKey = this.settings.noteIconKey;

		if (baseFrontMatter[noteIconKey] !== undefined) {
			publishedFrontMatter["noteIcon"] = baseFrontMatter[noteIconKey];
		} else {
			publishedFrontMatter["noteIcon"] = this.settings.defaultNoteIcon;
		}

		return publishedFrontMatter;
	}

	private addFrontMatterSettings(
		baseFrontMatter: Record<string, unknown>,
		newFrontMatter: Record<string, unknown>,
	) {
		if (!baseFrontMatter) {
			baseFrontMatter = {};
		}
		const publishedFrontMatter = { ...newFrontMatter };

		for (const key of Object.keys(this.settings.defaultNoteSettings)) {
			const settingValue = baseFrontMatter[kebabize(key)];

			if (settingValue) {
				publishedFrontMatter[key] = settingValue;
			}
		}

		const dgPassFrontmatter =
			this.settings.defaultNoteSettings.dgPassFrontmatter;

		if (dgPassFrontmatter) {
			publishedFrontMatter.dgPassFrontmatter = dgPassFrontmatter;
		}

		return publishedFrontMatter;
	}
}
