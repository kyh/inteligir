const mongoose = require('mongoose');
const boom = require('boom');
const requireLogin = require('@server/middlewares/requireLogin');

const Lesson = mongoose.model('Lesson');

const MOCK_DATA = require('./mock-data.json');

module.exports = (server) => {
  server.get('/api/lessons/:id', async (req, res) => {
    // const lesson = await Lesson.findOne({
    //   _user: req.user.id,
    //   _id: req.params.id,
    // });

    // if (!lesson) res.sendError(boom.notFound('Lesson not found'));

    // res.sendSuccess(lesson);
    const lesson = MOCK_DATA.find((l) => l._id === +req.params.id);
    res.sendSuccess(lesson);
  });

  server.get('/api/lessons', async (req, res) => {
    const lessons = await Lesson.find({ _user: req.user.id });
    res.sendSuccess(MOCK_DATA);
  });

  server.post('/api/lessons', requireLogin, async (req, res) => {
    const { title, content, imageUrl } = req.body;

    const lesson = new Lesson({
      title,
      content,
      imageUrl,
      likes: 0,
      authors: [req.user.id],
    });

    try {
      await lesson.save();
      res.sendSuccess(lesson);
    } catch (err) {
      res.sendError(boom.badRequest(err));
    }
  });
};
