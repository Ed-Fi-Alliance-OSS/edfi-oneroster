drop index if exists oneroster12.demographics_sourcedid;
drop materialized view if exists oneroster12.demographics;
--
create materialized view if not exists oneroster12.demographics as
with student as (
    select
    	student.*,
        -- if any studentEdOrgAssn has hispaniclatinoethnicity, then the student does
    	coalesce(bool_or(seoa.hispaniclatinoethnicity), false) as hispaniclatinoethnicity,
        -- used to compute a true lastmodifieddate below
        max(seoa.lastmodifieddate) as edorg_lmdate
	from student
        join edfi.studenteducationorganizationassociation seoa
        	on student.studentusi = seoa.studentusi
    group by student.studentusi
),
student_race as (
    select
        studentusi,
        array_agg(mappedracedescriptor.mappedvalue::text) as race_array
    from edfi.studenteducationorganizationassociationrace seoar
        join edfi.descriptor racedescriptor
            on seoar.racedescriptorid=racedescriptor.descriptorid
        left join edfi.descriptormapping mappedracedescriptor
            on mappedracedescriptor.value=racedescriptor.codevalue
                and mappedracedescriptor.namespace=racedescriptor.namespace
                and mappedracedescriptor.mappednamespace='uri://1edtech.org/oneroster12/RaceDescriptor'
    group by 1
)
-- property documentation at
-- https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#Main6p10p2
select 
    md5(student.id::text) as "sourcedId", -- unique ID constructed from natural key of Ed-Fi Students
    'active' as "status",
    greatest(student.lastmodifieddate, student.edorg_lmdate) as "dateLastModified",
    birthdate::text as "birthDate",
    mappedsexdescriptor.mappedvalue as "sex",
    race_array @> array['americanIndianOrAlaskaNative']         as "americanIndianOrAlaskaNative",
    race_array @> array['asian']                                as "asian",
    race_array @> array['blackOrAfricanAmerican']               as "blackOrAfricanAmerican",
    race_array @> array['nativeHawaiianOrOtherPacificIslander'] as "nativeHawaiianOrOtherPacificIslander",
    race_array @> array['white']                                as "white",
    (array_length(race_array, 1) > 1) as "demographicRaceTwoOrMoreRaces",
    hispaniclatinoethnicity as "hispanicOrLatinoEthnicity",
    countrydescriptor.codevalue as "countryOfBirthCode",
    statedescriptor.codevalue as "stateOfBirthAbbreviation",
    birthcity as "cityOfBirth",
    null as "publicSchoolResidenceStatus",
    json_build_object(
        'edfi', json_build_object(
            'resource', 'students',
            'naturalKey', json_build_object(
                'studentUniqueId', student.studentUniqueId
            )
        )
    ) AS metadata
from student
    left join student_race
        on student.studentusi = student_race.studentusi
    left join edfi.descriptor sexdescriptor
        on student.birthsexdescriptorid=sexdescriptor.descriptorid
    left join edfi.descriptormapping mappedsexdescriptor
        on mappedsexdescriptor.value=sexdescriptor.codevalue
            and mappedsexdescriptor.namespace=sexdescriptor.namespace
            and mappedsexdescriptor.mappednamespace='uri://1edtech.org/oneroster12/SexDescriptor'
    left join edfi.descriptor countrydescriptor
        on student.birthcountrydescriptorid=countrydescriptor.descriptorid
    left join edfi.descriptor statedescriptor
        on student.birthstateabbreviationdescriptorid=statedescriptor.descriptorid;

-- Add an index so the materialized view can be refreshed _concurrently_:
create index if not exists demographics_sourcedid ON oneroster12.demographics ("sourcedId");