require("dotenv").config();

import axios, { Method } from "axios";
import URL from "url-parse";
import { getTweet } from "./twitter";

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

const getGems = async (page = 1) => {
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

const main = async () => {
  const { data } = await getGems();
  const gem = data[0];
  console.log("gem:", gem);
  const tweetId = extractTweetId(gem);
  console.log("tweetId:", tweetId);
  const { data: tweet } = await getTweet(tweetId);
  console.log("tweet:", tweet);
};

if (require.main === module) {
  main();
}
