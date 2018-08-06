const mongoose = require('mongoose');
const boom = require('boom');
const requireLogin = require('middlewares/requireLogin');

const Lesson = mongoose.model('Lesson');

const FAKE_DATA = [
  {
    _id: 1,
    title:
      'Why the tech sector may not solve America’s looming automation crisis',
    thumbnailUrl: '',
    likes: 212,
    authors: [
      { _id: 1, displayName: 'Kevin Wu' },
      { _id: 2, displayName: 'Kaiyu Hsu' },
    ],
  },
  {
    _id: 2,
    title: 'What Airport Traffic Tells Us About the World’s Megacities',
    thumbnailUrl: '',
    likes: 70,
    authors: [{ _id: 1, displayName: 'Kaiyu Hsu' }],
  },
  {
    _id: 3,
    title: 'Let’s Talk About Birth Control',
    thumbnailUrl: '',
    likes: 11,
    authors: [{ _id: 1, displayName: 'John Boggs' }],
  },
  {
    _id: 4,
    title: 'The Largest Analysis of Film Dialogue by Gender, Ever',
    thumbnailUrl: '',
    likes: 15,
    authors: [{ _id: 1, displayName: 'Yao Yang' }],
  },
  {
    _id: 5,
    title: 'A visual introduction to Machine Learning',
    thumbnailUrl: '',
    likes: 22,
    authors: [{ _id: 1, displayName: 'Avesh Singh' }],
  },
  {
    _id: 6,
    title: 'Are Pop Lyrics Getting More Repetitive?',
    thumbnailUrl: '',
    likes: 97,
    authors: [{ _id: 1, displayName: 'Kaiyu Hsu' }],
  },
  {
    _id: 7,
    title: 'What City is the Microbrew Capital of the US?',
    thumbnailUrl: '',
    likes: 19,
    authors: [{ _id: 1, displayName: 'Kevin Wu' }],
  },
  {
    _id: 8,
    title: 'Hollywood’s Gender Divide and its Effect on Films',
    thumbnailUrl: '',
    likes: 54,
    authors: [{ _id: 1, displayName: 'Kevin Wu' }],
  },
];

module.exports = (app) => {
  app.get('/api/lessons/:id', requireLogin, async (req, res) => {
    const lesson = await Lesson.findOne({
      _user: req.user.id,
      _id: req.params.id,
    });

    if (!lesson) res.sendError(boom.notFound('Lesson not found'));

    res.sendSuccess(lesson);
  });

  app.get('/api/lessons', requireLogin, async (req, res) => {
    const lessons = await Lesson.find({ _user: req.user.id });
    res.sendSuccess(FAKE_DATA);
  });

  app.post('/api/lessons', requireLogin, async (req, res) => {
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
