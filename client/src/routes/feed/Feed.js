import React from 'react';
import { Link } from 'react-router-dom';
import LessonList from 'routes/feed/LessonList';

const Dashboard = () => {
  return (
    <section className="padded-page">
      <LessonList />
      <div className="fixed-action-btn">
        <Link to="/lessons/new" className="btn-floating btn-large red">
          Add new lesson
        </Link>
      </div>
    </section>
  );
};

export default Dashboard;
