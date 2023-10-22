import { join } from "node:path";
import { getServerSideSitemap } from "next-sitemap";
import { allTemplates } from "contentlayer/generated";

const siteUrl = "https://inteligir.com";

export const GET = () => {
  const urls = getSiteUrls();
  const posts = getTemplatesSitemap();

  return getServerSideSitemap([...urls, ...posts]);
};

const getSiteUrls = () => {
  const urls = [""];

  return urls.map((url) => {
    return {
      loc: join(siteUrl, url),
      lastmod: new Date().toISOString(),
    };
  });
};

const getTemplatesSitemap = () => allTemplates.map((post) => {
    return {
      loc: join(siteUrl, post._id),
      lastmod: new Date().toISOString(),
    };
  });
