const admin = require("firebase-admin");
const functions = require("firebase-functions");

admin.initializeApp(functions.config().firebase);

// const search = require("./lib/search");
const lessonFlags = require("./lib/lessonFlags");
const lessonLikes = require("./lib/lessonLikes");

// exports.updatelessonInSearchIndex = functions.firestore
//   .document("lessons/{lessonId}")
//   .onWrite(search.updatelessonInSearchIndex);

exports.updateLessonLikeCount = functions.firestore
  .document("lessonLikes/{lessonLikeId}")
  .onWrite(lessonLikes.updateLessonLikeCount);

exports.updateLessonFlag = functions.firestore
  .document("lessonFlags/{lessonFlagId}")
  .onWrite(lessonFlags.updateLessonFlag);
