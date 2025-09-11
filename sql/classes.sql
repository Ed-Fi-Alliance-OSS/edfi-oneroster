drop index if exists oneroster12.classes_sourcedid;
drop materialized view if exists oneroster12.classes;
--
create materialized view if not exists oneroster12.classes as
with section as (
    select * from edfi.section
),
courseoffering as (
    -- avoid column ambiguity in next step
    select 
        off.*,
        sch.localEducationAgencyId
    from edfi.courseoffering off 
        join edfi.school sch
            on off.schoolid = sch.schoolid
),
periods as (
    select 
        sectionidentifier,
        string_agg(distinct classperiodname, ',') as periods
    from edfi.sectionclassperiod
    group by 1
),
-- property documentation at
-- https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#Main6p6p2
classes as (
	select 
	    md5(concat(
            lower(section.localcoursecode)::varchar,
            '-', section.schoolid::varchar,
            '-', lower(section.sectionidentifier)::varchar,
            '-', lower(section.sessionname)::varchar)
        ) as "sourcedId", -- unique ID constructed from natural key of Ed-Fi Sections
	    'active' as "status",
	    section.lastmodifieddate as "dateLastModified", 
	    case
            when courseoffering.localcoursetitle is null then ''
            else courseoffering.localcoursetitle
        end as "title", -- consider adding section_id here?
	    section.localcoursecode as "classCode", 
	    'scheduled' as "classType", -- do we need a homeroom indicator?
	    section.locationclassroomidentificationcode as "location",
	    null as "grades",
	    null as "subjects",
	    json_build_object(
            'href', concat('/courses/', md5(concat(
                courseoffering.educationOrganizationId::varchar,
                '-', courseoffering.courseCode::varchar
            ))),
            'sourcedId', md5(concat(
                courseoffering.educationOrganizationId::varchar,
                '-', courseoffering.courseCode::varchar)
            ),  -- unique ID constructed from natural key of Ed-Fi Courses
            'type', 'course'
        ) as "course",
	    json_build_object(
            'href', concat('/orgs/', md5(section.schoolid::varchar)),
            'sourcedId', md5(
                section.schoolid::varchar
            ),  -- unique ID constructed from natural key of Ed-Fi Schools
            'type', 'org'
        ) as "school",
	    jsonb_build_array(json_build_object(
            'href', concat('/academicSessions/', md5(concat(
                section.schoolid::varchar,
                '-', section.sessionname::varchar
            ))),
            'sourcedId', md5(concat(
                section.schoolid::varchar,
                '-', section.sessionname::varchar)
            ), -- unique ID constructed from natural key of Ed-Fi Sessions
            'type', 'academicSession'
        )) as "terms",
	    null as "subjectCodes",
	    periods.periods as "periods",
        null as resources,
        json_build_object(
            'edfi', json_build_object(
                'resource', 'sections',
                'naturalKey', json_build_object(
                    'localCourseCode', section.localcoursecode,
                    'schoolid', section.schoolid,
                    'sectionIdentifier', section.sectionidentifier,
                    'sessionName', section.sessionname
                )
            )
        ) AS metadata
	from section
	    join courseoffering
            on section.localcoursecode = courseoffering.localcoursecode
            AND section.schoolid = courseoffering.schoolid
            AND section.schoolyear = courseoffering.schoolyear  
            AND section.sessionname = courseoffering.sessionname
	    left join periods
            on section.sectionidentifier = periods.sectionidentifier
)
select * from classes;

-- Add an index so the materialized view can be refreshed _concurrently_:
create index if not exists classes_sourcedid ON oneroster12.classes ("sourcedId");