const functions = require("firebase-functions");
const Algolia = require("algoliasearch");

const ALGOLIA_APP_ID = functions.config().algolia.app_id;
const ALGOLIA_ADMIN_KEY = functions.config().algolia.admin_key;
const algolia = Algolia(ALGOLIA_APP_ID, ALGOLIA_ADMIN_KEY);
const lessonIndex = algolia.initIndex("lessons");

// Algolia search - update search index
// https://www.algolia.com/doc/tutorials/indexing/3rd-party-service/firebase-algolia/
exports.updateLessonInSearchIndex = (change, context) => {
  const lesson = change.after.data();

  if (!lesson) {
    return lessonIndex.deleteObject(context.params.lessonId);
  }

  lesson.objectID = context.params.lessonId;
  return lessonIndex.saveObject(lesson);
};
