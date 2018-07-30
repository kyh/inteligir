const mongoose = require('mongoose');
const { Schema } = mongoose;

const lessonSchema = new Schema({
  title: String,
  content: String,
  imageUrl: String,
  createdAt: { type: Date, default: Date.now },
  _user: { type: Schema.Types.ObjectId, ref: 'User' },
});

mongoose.model('Lesson', lessonSchema);
