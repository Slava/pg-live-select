DROP TABLE IF EXISTS employees;

CREATE TABLE employees(
  id serial primary key,
  name varchar not null,
  age int not null
);

INSERT INTO employees(name, age) VALUES('slava', 20);
INSERT INTO employees(name, age) VALUES('petya', 12);
INSERT INTO employees(name, age) VALUES('grigory', 30);
INSERT INTO employees(name, age) VALUES('helma', 71);
INSERT INTO employees(name, age) VALUES('jackie', 25);
