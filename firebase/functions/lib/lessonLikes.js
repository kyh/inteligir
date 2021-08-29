const admin = require("firebase-admin");

const getNumberOfLessonLikes = (lessonId) => {
  return admin
    .firestore()
    .collection("lessonLikes")
    .where("lessonId", "==", lessonId)
    .get()
    .then((snapshot) => snapshot.size);
};

const setLessonLikeCount = (lessonId, count) => {
  return admin.firestore().collection("lessons").doc(lessonId).update({
    _likeCount: count,
  });
};

// update _likeCount on a lesson when it's liked or unliked
exports.updatelessonLikeCount = (change, context) => {
  const lessonId = change.after.exists
    ? change.after.data().lessonId
    : change.before.data().lessonId;
  return getNumberOfLessonLikes(lessonId).then((count) =>
    setLessonLikeCount(lessonId, count)
  );
};
