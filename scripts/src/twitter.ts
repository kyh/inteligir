import axios, { Method } from "axios";

const TWITTER_TOKEN = process.env.TWITTER_TOKEN;

export const getTweet = async (id: string) => {
  const config = {
    method: "GET" as Method,
    url: `https://api.twitter.com/2/tweets/${id}?tweet.fields=attachments,author_id,context_annotations,conversation_id,entities,id,in_reply_to_user_id,public_metrics,referenced_tweets,text,withheld&expansions=attachments.poll_ids,attachments.media_keys,author_id,geo.place_id,in_reply_to_user_id,referenced_tweets.id,entities.mentions.username,referenced_tweets.id.author_id`,
    headers: {
      Authorization: `Bearer ${TWITTER_TOKEN}`,
    },
  };
  const response = await axios(config);

  return response.data;
};

export const getThread = async (_id: string) => {};
