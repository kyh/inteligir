import { fetcher } from "./util";
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
  const path = "https://upksilll-web.herokuapp.com/posts";
  const config = {
    params: {
      pageNo: page,
    },
    headers: {
      Authorization: `Bearer ${GEM_TOKEN}`,
    },
  };

  const response = await fetcher.get(path, {}, config);

  return response as { data: Gem[]; pageNo: number; totalPages: number };
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
  const path =
    "https://v1.nocodeapi.com/kaiyu/google_sheets/pCKJEbKOzytqoCjN?tabId=Sheet1";

  const response = await fetcher.get(path);

  return response.data.reduce(
    (map: Record<string, SavedGem>, savedGem: SavedGem) => {
      map[savedGem.gem_id] = savedGem;
      return map;
    },
    {}
  );
};

const insertGems = async (gems: Gem[]) => {
  const path =
    "https://v1.nocodeapi.com/kaiyu/google_sheets/pCKJEbKOzytqoCjN?tabId=Sheet1";
  const data = gems.map((g) => [
    g._id,
    extractTweetId(g),
    g.link,
    JSON.stringify(g.category),
  ]);

  const response = await fetcher.post(path, data);

  return response;
};

const main = async () => {
  console.log("getting saved gems...");
  const savedMap = await getSavedGems();
  console.log(`we have ${Object.keys(savedMap).length} saved gems`);
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
        try {
          const response = await insertGems([gem]);
          console.log("response:", response);
        } catch (error) {
          console.log("error:", error);

          // try a second time after a while
          setTimeout(async () => {
            console.log("retying saving gem:", gem);
            try {
              const response = await insertGems([gem]);
              console.log("response:", response);
            } catch (error) {
              console.log("error on retry:", error);
            }
          }, 500);
        }
      }
    }

    pageNo = response.pageNo + 1;
    totalPages = response.totalPages;
  }
};

if (require.main === module) {
  main();
}
