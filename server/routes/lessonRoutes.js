const mongoose = require('mongoose');
const requireLogin = require('../middlewares/requireLogin');
const cleanCache = require('../middlewares/cleanCache');
const {
  sendSuccess,
  sendError,
  throwIf,
  throwError,
  ERRORS,
} = require('../services/route-util');

const Lesson = mongoose.model('Lesson');

module.exports = (app) => {
  app.get('/api/lessons/:id', requireLogin, async (req, res) => {
    try {
      await Lesson.findOne({
        _user: req.user.id,
        _id: req.params.id,
      })
        .then(
          throwIf(
            (lesson) => !lesson,
            404,
            ERRORS.notFound,
            'Lesson not found',
          ),
          throwError(500, ERRORS.database),
        )
        .then(sendSuccess(res));
    } catch (error) {
      sendError(res)(error);
    }
  });

  app.get('/api/lessons', requireLogin, async (req, res) => {
    try {
      await Lesson.find({ _user: req.user.id })
        .then(sendSuccess(res), throwError(500, ERRORS.database))
        .cache({
          key: req.user.id,
        });
    } catch (error) {
      sendError(res)(error);
    }
  });

  app.post('/api/lessons', requireLogin, cleanCache, async (req, res) => {
    const { title, content } = req.body;

    const lesson = new Lesson({
      title,
      content,
      _user: req.user.id,
    });

    try {
      await lesson
        .save()
        .then(sendSuccess(res), throwError(500, ERRORS.database));
    } catch (error) {
      sendError(res)(error);
    }
  });
};
