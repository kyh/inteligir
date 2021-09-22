require("dotenv").config();

import axios, { Method } from "axios";
import URL from "url-parse";

const GEM_TOKEN = process.env.TWITTRGEM_TOKEN;

type Gem = {
  category: string[];
  authorImg: string;
  _id: string;
  link: string;
  author: string;
  title: string;
  photo: {
    url: string;
  };
  tag: string;
  __v: number;
};

const getRawGems = async (page = 1) => {
  const config = {
    method: "GET" as Method,
    url: "https://upksilll-web.herokuapp.com/posts",
    params: {
      pageNo: page,
    },
    headers: {
      Authorization: `Bearer ${GEM_TOKEN}`,
    },
  };

  const response = await axios(config);

  return response.data as { data: Gem[]; pageNo: number; totalPages: number };
};

const extractTweetId = (gem: Gem) => {
  const url = new URL(gem.link);
  const paths = url.pathname.split("/");
  return paths[paths.length - 1];
};

type SavedGem = {
  gem_id: string;
  tweet_id: string;
  link: string;
  tags: string;
};

const getSavedGems = async () => {
  const config = {
    method: "GET" as Method,
    url: "https://v1.nocodeapi.com/kaiyu/google_sheets/pCKJEbKOzytqoCjN?tabId=Sheet1",
  };

  const response = await axios(config);

  return response.data.data.reduce(
    (map: Record<string, SavedGem>, savedGem: SavedGem) => {
      map[savedGem.gem_id] = savedGem;
      return map;
    },
    {}
  );
};

const insertGems = async (gems: Gem[]) => {
  const config = {
    method: "POST" as Method,
    url: "https://v1.nocodeapi.com/kaiyu/google_sheets/pCKJEbKOzytqoCjN?tabId=Sheet1",
    data: gems.map((g) => [
      g._id,
      extractTweetId(g),
      g.link,
      JSON.stringify(g.category),
    ]),
  };

  const response = await axios(config);
  return response.data;
};

const main = async () => {
  const savedMap = await getSavedGems();
  console.log("saved gems:", Object.keys(savedMap));
  let pageNo = 1;
  let totalPages = 100;

  while (pageNo <= totalPages) {
    console.log(`getting raw gems for page ${pageNo}...`);
    const response = await getRawGems(pageNo);
    console.log(`got ${response.data.length} gems`);

    for (const gem of response.data) {
      if (savedMap[gem._id]) {
        console.log("already saved:", gem._id);
      } else {
        console.log("saving gem:", gem);
        const response = await insertGems([gem]);
        console.log("response:", response);
      }
    }

    pageNo = response.pageNo + 1;
    totalPages = response.totalPages;
  }
};

if (require.main === module) {
  main();
}
